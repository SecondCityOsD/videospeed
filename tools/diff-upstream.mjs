// Differential fuzz: upstream engine modules vs the fork's UXP ports.
//
// Each implementation runs in its own node:vm realm with a fake clock and
// timers; identical seeded traces must produce identical observable logs
// (return values, thrown errors, writes, timers, listener traffic). This
// proves the down-levelling in tools/port-upstream.mjs changed syntax only.
// It also checks global-scope hygiene: loaded as classic scripts, the fork's
// modules may add nothing but window.VSC, and must survive a second load.
//
//   node tools/diff-upstream.mjs [<upstream-src>] [<fork-src>]
//
// Defaults: ../videospeed-0.11.1/src next to this repository, and ./src.
// Exits non-zero on any divergence. Takes ~20 s.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UP = path.resolve(process.argv[2] || path.join(repoRoot, '..', 'videospeed-0.11.1', 'src'));
const FORK = path.resolve(process.argv[3] || path.join(repoRoot, 'src'));
const FILES = [
  'core/arbiter.js',
  'core/intent-classifier.js',
  'core/speed-arbitration.js',
  'core/controller-visibility.js',
];

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRealm(root, log) {
  const clock = { now: 0, timers: new Map(), nextId: 1 };
  const sandbox = {
    console,
    performance: { now: () => clock.now },
    Event: { NONE: 0, CAPTURING_PHASE: 1, AT_TARGET: 2, BUBBLING_PHASE: 3 },
    setTimeout: (fn, ms) => {
      const id = clock.nextId++;
      clock.timers.set(id, { fn, at: clock.now + ms });
      return id;
    },
    clearTimeout: (id) => clock.timers.delete(id),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const rel of FILES) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
  }
  sandbox.VSC.Constants = { SPEED_LIMITS: { MIN: 0.07, MAX: 16 } };
  sandbox.VSC.logger = {
    debug: (m) => log.push(['log.debug', m]),
    info: (m) => log.push(['log.info', m]),
  };
  const advance = (ms) => {
    const until = clock.now + ms;
    for (;;) {
      let due = null;
      for (const [id, t] of clock.timers) {
        if (t.at <= until && (!due || t.at < due[1].at || (t.at === due[1].at && id < due[0]))) {
          due = [id, t];
        }
      }
      if (!due) break;
      clock.timers.delete(due[0]);
      clock.now = due[1].at;
      due[1].fn();
    }
    clock.now = until;
  };
  return { VSC: sandbox.VSC, clock, advance };
}

// Run `scenario(realm, rng, log)` against both trees; return mismatching seeds.
function differential(name, seeds, scenario) {
  let steps = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const logs = [UP, FORK].map((root) => {
      const log = [];
      const realm = makeRealm(root, log);
      scenario(realm, mulberry32(seed), log);
      return log;
    });
    const [a, b] = logs.map((l) => JSON.stringify(l));
    steps += logs[0].length;
    if (a !== b) {
      for (let i = 0; i < Math.max(logs[0].length, logs[1].length); i++) {
        if (JSON.stringify(logs[0][i]) !== JSON.stringify(logs[1][i])) {
          console.error(`${name}: seed ${seed} diverges at entry ${i}`);
          console.error('  upstream:', JSON.stringify(logs[0][i]));
          console.error('  fork    :', JSON.stringify(logs[1][i]));
          break;
        }
      }
      process.exitCode = 1;
      return;
    }
  }
  console.log(`${name}: ${seeds} seeds, ${steps} logged observations identical`);
}

const pick = (rng, xs) => xs[Math.floor(rng() * xs.length)];
const attempt = (log, label, fn) => {
  try {
    log.push([label, fn()]);
  } catch (e) {
    log.push([label, 'THROW', e.constructor.name, e.message]);
  }
};

// ---- SpeedArbiter ---------------------------------------------------------
differential('SpeedArbiter', 3000, ({ VSC }, rng, log) => {
  const A = VSC.SpeedArbiter;
  const speeds = [null, undefined, 0.5, 1, 1.5, 2, 2.5];
  log.push(['consts', A.MODES, A.EVENTS, A.RATE_CLASSES, A.EFFECTS, A.DEFAULT_MAX_FIGHT]);
  let state = A.loadState(
    pick(rng, [
      undefined,
      {},
      { siteRuleSpeed: pick(rng, speeds) },
      { rememberEnabled: rng() < 0.5, rememberedSpeed: pick(rng, speeds) },
      { siteRuleSpeed: pick(rng, speeds), rememberEnabled: true, rememberedSpeed: 1.25 },
    ])
  );
  log.push(['load', state, Object.isFrozen(state)]);
  for (let i = 0; i < 40; i++) {
    const event = {
      type: pick(rng, [...Object.values(A.EVENTS), ...Object.values(A.EVENTS), 'BOGUS']),
      speed: pick(rng, speeds.slice(2)),
      rateClass: pick(rng, [...Object.values(A.RATE_CLASSES), 'BOGUS']),
      quiet: pick(rng, [true, false, undefined]),
    };
    const options = pick(rng, [undefined, {}, { maxFight: 2 }, { maxFight: null }]);
    try {
      const result = A.step(state, event, options);
      log.push(['step', event, result.state, result.effects]);
      state = result.state;
    } catch (e) {
      log.push(['step', event, 'THROW', e.message]);
    }
  }
});

// ---- ControllerVisibility (exhaustive) ------------------------------------
differential('ControllerVisibility', 1, ({ VSC }, rng, log) => {
  const CV = VSC.ControllerVisibility;
  log.push(['consts', CV.OVERRIDES, CV.FLASH, CV.MEDIA_TYPES, CV.EVENTS]);
  const bools = [true, false];
  const values = [true, false, undefined, 'x'];
  for (const attached of bools)
    for (const override of [...Object.values(CV.OVERRIDES), 'bogus'])
      for (const automaticHidden of bools)
        for (const noSource of bools)
          for (const siteAutohide of bools)
            for (const hostHidden of bools)
              for (const flash of Object.values(CV.FLASH))
                for (const startHidden of bools)
                  for (const mediaType of Object.values(CV.MEDIA_TYPES)) {
                    const s = {
                      attached,
                      override,
                      automaticHidden,
                      noSource,
                      siteAutohide,
                      hostHidden,
                      flash,
                      startHidden,
                      mediaType,
                    };
                    attempt(log, 'create', () => CV.createState(s));
                    attempt(log, 'visible', () => CV.isVisible(s));
                    attempt(log, 'allowsFlash', () => CV.allowsFlash(s));
                    for (const type of [...Object.values(CV.EVENTS), 'BOGUS'])
                      for (const value of values)
                        attempt(log, 'step', () =>
                          CV.step(s, { type, value, renderedVisible: value })
                        );
                  }
  for (const input of [null, undefined, 0, '', {}, { attached: false }, { startHidden: 1 }, { override: 'hide' }]) {
    attempt(log, 'allowsFlash', () => CV.allowsFlash(input));
  }
  for (const o of [undefined, null, 'auto', 'show', 'hide', 'x'])
    for (const r of [true, false, undefined]) {
      attempt(log, 'nextOverride', () => CV.nextOverride(o, r));
      attempt(log, 'normalize', () => CV.normalizeOverride(o));
    }
  attempt(log, 'step-null-event', () => CV.step(CV.createState(), null));
  attempt(log, 'createState-default', () => CV.createState());
});

// ---- IntentClassifier -----------------------------------------------------
function classifierOps(rng, IC, media, log, clockTs) {
  const m = () => pick(rng, [null, ...media]);
  const idx = (x) => (x === null || x === undefined ? x : media.indexOf(x));
  const ev = () => ({
    timeStamp: clockTs(),
    pointerId: pick(rng, [1, 2, 3, undefined, 1.5]),
    key: pick(rng, ['<', '>', 'a', ' ', 'Shift']),
    code: pick(rng, ['Comma', 'Period', 'Space', 'KeyA', undefined]),
    keyCode: pick(rng, [188, 190, 32, 65]),
    shiftKey: rng() < 0.5,
  });
  return [
    (c) => c.observeInput(ev()),
    (c) => c.observeUnhandledKey(ev()),
    (c) => idx(c.observeKeyEnd(ev())),
    (c) => c.observeClick(ev(), m()),
    (c) => c.observeClick(ev(), m()),
    (c) => c.observeSeek(m(), clockTs()),
    (c) => c.observeMediaInit(m(), clockTs()),
    (c) => c.observePointerDown(ev(), m()),
    (c) => c.observePointerEnd(ev()).map(idx),
    (c) => c.clearPointerHolds().map(idx),
    (c) => c.clearTemporaryHolds().map(idx),
    (c) => c.hasActiveTemporaryHoldFor(m(), clockTs()),
    (c) => c.hasStrongIntent({ media: m(), timeStamp: clockTs() }),
    (c) =>
      c.classify({
        media: m(),
        rate: pick(rng, [1, 1.002, 2, 2.005, 1.5, 0.07, 0.05, NaN, undefined]),
        timeStamp: clockTs(),
        readyState: pick(rng, [0, 1, 4]),
        detail: pick(rng, [null, { origin: 'videoSpeed' }, { origin: 'x' }]),
      }),
    (c) =>
      c.classify({
        media: m(),
        rate: pick(rng, [1, 2, 1.75]),
        timeStamp: clockTs(),
        readyState: 4,
        detail: null,
      }),
    (c) => c.isQuietContext(clockTs()),
    (c) => c.consumeGesture(m()),
    (c) => c.releaseMedia(pick(rng, media)),
    (c) => (rng() < 0.05 ? c.reset() : undefined),
    () => {
      const target = pick(rng, media);
      target.seeking = !target.seeking;
    },
  ];
}

differential('IntentClassifier', 1500, ({ VSC }, rng, log) => {
  const IC = VSC.IntentClassifier;
  log.push(['consts', IC.VERDICTS, IC.TARGET_RULES, IC.USER_GESTURE_WINDOW_MS, IC.QUIET_CONTEXT_MS]);
  if (rng() < 0.2) VSC.logger = undefined;
  const rules = pick(rng, [
    undefined,
    { pointerHoldArms: true, spacebarArms: true },
    { pointerHoldArms: true },
    { spacebarArms: true },
  ]);
  const c = new IC({ rules, minRate: pick(rng, [undefined, null, 0.07, 0.1]) });
  const media = [0, 1, 2].map((i) => ({ id: i, seeking: false }));
  let ts = 0;
  const clockTs = () => (ts += pick(rng, [0, 1, 10, 50, 120, 299, 301, 450, 999, 1500, 2100, 5001]));
  const ops = classifierOps(rng, IC, media, log, clockTs);
  for (let i = 0; i < 120; i++) {
    const op = Math.floor(rng() * ops.length);
    attempt(log, `op${op}`, () => ops[op](c));
  }
  log.push(['final', c.lastGestureAt, c.lastClickAt, c.lastInputAt, c.spaceHoldActive]);
});

// ---- SpeedArbitration adapter --------------------------------------------
differential('SpeedArbitration', 1500, ({ VSC, clock, advance }, rng, log) => {
  const SA = VSC.SpeedArbitration;
  log.push(['consts', SA.FIGHT_WINDOW_MS, SA.ECHO_TOLERANCE, SA.ECHO_TTL_MS, SA.ECHO_MAX_PENDING]);
  const handlerRules = pick(rng, [
    null,
    { getClassifierRules: () => ({ pointerHoldArms: true, spacebarArms: true }) },
    { getClassifierRules: () => null },
    {},
  ]);
  if (handlerRules) VSC.siteHandlerManager = handlerRules;

  const videos = [0, 1].map((id) => {
    const listeners = [];
    return {
      id,
      playbackRate: 1,
      seeking: false,
      listeners,
      addEventListener: (type, fn) => {
        listeners.push(fn);
        log.push(['addListener', id, type]);
      },
      removeEventListener: (type, fn) => {
        const at = listeners.indexOf(fn);
        if (at !== -1) listeners.splice(at, 1);
        log.push(['removeListener', id, type, at]);
      },
    };
  });
  const config = {
    settings: { lastSpeed: pick(rng, [null, 1, 1.5]) },
    persistAuthority(speed) {
      log.push(['persist', speed]);
      this.settings.lastSpeed = speed;
    },
  };
  const actionHandler = {
    writeRate(video, rate, opts) {
      log.push(['writeRate', video.id, rate, opts]);
      video.playbackRate = rate;
    },
    syncIndicator(video, speed) {
      log.push(['sync', video.id, speed]);
    },
  };
  const eventManager = pick(rng, [{ actionHandler }, { actionHandler }, { actionHandler: null }, null]);
  const sa = new SA(config, eventManager);
  log.push(['rules', sa.classifier.rules]);

  const makeEvent = () => {
    const e = {
      timeStamp: clock.now,
      eventPhase: pick(rng, [0, 2, undefined]),
      stopImmediatePropagation: () => log.push(['stopImmediate', e.tag]),
      tag: Math.floor(rng() * 1000),
    };
    return e;
  };
  const echoes = [];
  const rates = [1, 1.005, 1.5, 2, 1.25];
  const ops = [
    () => {
      const v = pick(rng, videos);
      v.playbackRate = pick(rng, rates);
      sa.noteWrite(v, v.playbackRate, pick(rng, [undefined, { suppressPropagation: true }]));
    },
    () => {
      const v = pick(rng, videos);
      const echo = sa.consumeEcho(v, pick(rng, rates));
      if (echo) echoes.push([v, echo]);
      return echo && { rate: echo.rate, epoch: echo.epoch, s: echo.suppressPropagation };
    },
    () => {
      if (!echoes.length) return 'none';
      const [v, echo] = pick(rng, echoes);
      const e = makeEvent();
      sa.observePropagatedEcho(v, e, echo);
      if (rng() < 0.5) v.playbackRate = pick(rng, rates);
      for (const fn of [...v.listeners]) fn(rng() < 0.8 ? e : makeEvent());
    },
    () => sa.consumeEchoReaction(pick(rng, videos), makeEvent()),
    () =>
      sa.noteUserSet(pick(rng, videos), pick(rng, rates), pick(rng, [undefined, { startsAuthorityEpoch: false }])),
    () => sa.noteTemporaryOverrideEnd(pick(rng, videos)),
    () => {
      const v = pick(rng, videos);
      v.playbackRate = pick(rng, rates);
      const e = makeEvent();
      const verdict = sa.classifier.classify({
        media: v,
        rate: v.playbackRate,
        timeStamp: e.timeStamp,
        readyState: 4,
        detail: null,
      });
      sa.onExternalRate(v, e, verdict, pick(rng, [undefined, { suppressRetryEcho: true }]));
      return verdict;
    },
    () => {
      const v = pick(rng, videos);
      v.playbackRate = pick(rng, rates);
      sa.onExternalRate(v, makeEvent(), pick(rng, ['TEMPORARY_OVERRIDE', 'USER_INTENT', 'AUTONOMOUS']));
    },
    () => sa.lifecycleTarget(pick(rng, videos)),
    () => (rng() < 0.3 ? sa.release(pick(rng, videos)) : undefined),
    () => (rng() < 0.05 ? sa.cleanup() : undefined),
    () => advance(pick(rng, [10, 100, 260, 600, 3100])),
    () => (config.settings.lastSpeed = rng() < 0.1 ? null : config.settings.lastSpeed),
    () => sa.classifier.observePointerDown({ timeStamp: clock.now, pointerId: 1 }, pick(rng, [null, ...videos])),
    () => sa.classifier.observePointerEnd({ timeStamp: clock.now, pointerId: 1 }).map((v) => v.id),
    () => sa.classifier.observeClick({ timeStamp: clock.now }, pick(rng, [null, ...videos])),
    () => sa.classifier.observeUnhandledKey({ timeStamp: clock.now, key: '>', code: 'Space', keyCode: 32 }),
  ];
  for (let i = 0; i < 100; i++) {
    const op = Math.floor(rng() * ops.length);
    attempt(log, `op${op}`, ops[op]);
    log.push(['rates', videos.map((v) => v.playbackRate), sa.authorityEpoch, sa.echoTransactions.size]);
  }
});

// ---- Global-scope hygiene ---------------------------------------------------
for (const [label, root] of [['upstream', UP], ['fork', FORK]]) {
  const sandbox = { window: null };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const before = new Set(Object.getOwnPropertyNames(sandbox));
  const errors = [];
  for (const rel of FILES) {
    const code = fs.readFileSync(path.join(root, rel), 'utf8');
    for (let pass = 0; pass < 2; pass++) {
      try {
        vm.runInContext(code, sandbox, { filename: rel });
      } catch (e) {
        errors.push(`${rel} (load ${pass + 1}): ${e.message}`);
      }
    }
  }
  const leaked = Object.getOwnPropertyNames(sandbox).filter((k) => !before.has(k));
  console.log(`${label}: new global properties = [${leaked.join(', ')}]; double-load errors = ${errors.length}`);
  for (const e of errors.slice(0, 6)) console.log(`  ${e}`);
  // Upstream is expected to leak (it relies on its esbuild IIFE); the fork must not.
  if (label === 'fork' && (leaked.join() !== 'VSC' || errors.length > 0)) {
    console.error('fork: modules leak into the page global scope (missing IIFE wrapper?)');
    process.exitCode = 1;
  }
}
