/**
 * Action handling system for Video Speed Controller
 * UXP port with upstream 0.10.2 features
 */

window.VSC = window.VSC || {};

class ActionHandler {
  constructor(config, eventManager) {
    this.config = config;
    this.eventManager = eventManager;
  }

  runAction(action, value, e) {
    const mediaTags = window.VSC.stateManager
      ? window.VSC.stateManager.getControlledElements()
      : [];

    let targetController = null;
    if (e) {
      targetController = e.target.closest('.vsc-controller');
    }

    mediaTags.forEach((v) => {
      const controller = v.vsc?.div;

      if (!controller) {
        return;
      }

      if (e && targetController && !(targetController === controller)) {
        return;
      }

      if (!v.classList.contains('vsc-cancelled')) {
        this.executeAction(action, value, v, e);
      }
    });
  }

  executeAction(action, value, video, e) {
    switch (action) {
      case 'rewind':
        window.VSC.logger.debug('Rewind');
        this.seek(video, -value);
        break;

      case 'advance':
        window.VSC.logger.debug('Fast forward');
        this.seek(video, value);
        break;

      case 'faster': {
        window.VSC.logger.debug('Increase speed');
        this.adjustSpeed(video, value, { relative: true });
        break;
      }

      case 'slower': {
        window.VSC.logger.debug('Decrease speed');
        this.adjustSpeed(video, -value, { relative: true });
        break;
      }

      case 'reset':
        // R is a literal "reset to target" (default 1.0). UXP fork
        // deviation from upstream: upstream cross-toggles R with the
        // 'fast' preset (see resetSpeed below) which is documented in
        // their unit tests, but the user finds the toggle confusing.
        // Bypass resetSpeed and just adjust directly.
        window.VSC.logger.debug('Reset speed');
        this.adjustSpeed(video, value);
        break;

      case 'display': {
        window.VSC.logger.debug('Display action triggered');
        const controller = video.vsc.div;

        if (!controller) {
          window.VSC.logger.error('No controller found for video');
          return;
        }

        if (controller.flashTimer !== undefined) {
          clearTimeout(controller.flashTimer);
          controller.flashTimer = undefined;
        }

        controller.classList.toggle('vsc-hidden');
        controller.classList.add('vsc-manual');

        if (controller.classList.contains('vsc-hidden')) {
          controller.classList.remove('vsc-show');
        }
        break;
      }

      case 'blink':
        window.VSC.logger.debug('Showing controller momentarily');
        this.flashController(video.vsc.div, value);
        break;

      case 'drag':
        window.VSC.DragHandler.handleDrag(video, e);
        break;

      case 'fast':
        window.VSC.logger.debug('Preferred speed');
        this.resetSpeed(video, value, this.config.getKeyBinding('reset'));
        break;

      case 'pause':
        this.pause(video);
        break;

      case 'muted':
        this.muted(video);
        break;

      case 'louder':
        this.volumeUp(video, value);
        break;

      case 'softer':
        this.volumeDown(video, value);
        break;

      case 'mark':
        this.setMark(video);
        break;

      case 'jump':
        this.jumpToMark(video);
        break;

      case 'SET_SPEED':
        window.VSC.logger.info('Setting speed to:', value);
        this.adjustSpeed(video, value, { source: 'internal' });
        break;

      case 'ADJUST_SPEED':
        window.VSC.logger.info('Adjusting speed by:', value);
        this.adjustSpeed(video, value, { relative: true, source: 'internal' });
        break;

      case 'RESET_SPEED': {
        window.VSC.logger.info('Resetting speed');
        const preferredSpeed = this.config.getKeyBinding('fast') || 1.0;
        this.adjustSpeed(video, preferredSpeed, { source: 'internal' });
        break;
      }

      default:
        window.VSC.logger.warn(`Unknown action: ${action}`);
    }
  }

  seek(video, seekSeconds) {
    window.VSC.siteHandlerManager.handleSeek(video, seekSeconds);
  }

  pause(video) {
    if (video.paused) {
      window.VSC.logger.debug('Resuming video');
      video.play();
    } else {
      window.VSC.logger.debug('Pausing video');
      video.pause();
    }
  }

  resetSpeed(video, target, crossTarget) {
    if (!video.vsc) {
      window.VSC.logger.warn('resetSpeed called on video without controller');
      return;
    }

    const currentSpeed = video.playbackRate;

    if (currentSpeed === target) {
      if (video.vsc.speedBeforeReset !== null) {
        window.VSC.logger.info(`Restoring remembered speed: ${video.vsc.speedBeforeReset}`);
        const rememberedSpeed = video.vsc.speedBeforeReset;
        video.vsc.speedBeforeReset = null;
        this.adjustSpeed(video, rememberedSpeed);
      } else if (crossTarget && crossTarget !== target) {
        window.VSC.logger.info(`Cross-toggle from ${target} to ${crossTarget}`);
        video.vsc.speedBeforeReset = currentSpeed;
        this.adjustSpeed(video, crossTarget);
      }
    } else {
      window.VSC.logger.info(`Remembering speed ${currentSpeed} and resetting to ${target}`);
      video.vsc.speedBeforeReset = currentSpeed;
      this.adjustSpeed(video, target);
    }
  }

  muted(video) {
    video.muted = video.muted !== true;
  }

  volumeUp(video, value) {
    video.volume = Math.min(1, (video.volume + value).toFixed(2));
  }

  volumeDown(video, value) {
    video.volume = Math.max(0, (video.volume - value).toFixed(2));
  }

  setMark(video) {
    window.VSC.logger.debug('Adding marker');
    video.vsc.mark = video.currentTime;
  }

  jumpToMark(video) {
    if (
      video.vsc.mark === null ||
      video.vsc.mark === undefined ||
      typeof video.vsc.mark !== 'number'
    ) {
      return;
    }

    const currentTime = video.currentTime;

    if (video.vsc.positionBeforeJump !== null && Math.abs(currentTime - video.vsc.mark) < 0.05) {
      window.VSC.logger.debug('Jumping back to pre-marker position');
      video.currentTime = video.vsc.positionBeforeJump;
      video.vsc.positionBeforeJump = null;
    } else {
      window.VSC.logger.debug('Jumping to marker');
      video.vsc.positionBeforeJump = currentTime;
      video.currentTime = video.vsc.mark;
    }
  }

  flashController(controller, duration) {
    if (this.config.settings.startHidden) {
      window.VSC.logger.debug('flashController skipped: startHidden is a hard preference');
      return;
    }

    if (
      controller.classList.contains('vsc-manual') &&
      controller.classList.contains('vsc-hidden')
    ) {
      window.VSC.logger.debug('flashController skipped: user manually hid controller');
      return;
    }

    const isAudioController = this.isAudioController(controller);

    if (controller.flashTimer !== undefined) {
      clearTimeout(controller.flashTimer);
      controller.flashTimer = undefined;
    }

    controller.classList.add('vsc-show');
    window.VSC.logger.debug('Showing controller temporarily with vsc-show class');

    if (!isAudioController) {
      controller.flashTimer = setTimeout(() => {
        controller.classList.remove('vsc-show');
        controller.flashTimer = undefined;
        window.VSC.logger.debug('Removing vsc-show class after flash timeout');
      }, duration || 2000);
    } else {
      window.VSC.logger.debug('Audio controller flash - keeping vsc-show class');
    }
  }

  isAudioController(controller) {
    const mediaElements = window.VSC.stateManager
      ? window.VSC.stateManager.getControlledElements()
      : [];
    for (const media of mediaElements) {
      if (media.vsc && media.vsc.div === controller) {
        return media.tagName === 'AUDIO';
      }
    }
    return false;
  }

  adjustSpeed(video, value, options = {}) {
    if (!video || !video.vsc) {
      window.VSC.logger.warn('adjustSpeed called on video without controller');
      return;
    }

    if (typeof value !== 'number' || isNaN(value)) {
      window.VSC.logger.warn('adjustSpeed called with invalid value:', value);
      return;
    }

    const { relative = false, source = 'internal' } = options;

    let targetSpeed;
    if (relative) {
      const currentSpeed = video.playbackRate < 0.1 ? 0.0 : video.playbackRate;
      targetSpeed = currentSpeed + value;

      if ((currentSpeed > 1.0 && targetSpeed < 1.0) || (currentSpeed < 1.0 && targetSpeed > 1.0)) {
        targetSpeed = 1.0;
      }

      window.VSC.logger.debug(
        `Relative speed calculation: currentSpeed=${currentSpeed} + ${value} = ${targetSpeed}`
      );
    } else {
      targetSpeed = value;
      window.VSC.logger.debug(`Absolute speed set: ${targetSpeed}`);
    }

    targetSpeed = Math.min(
      Math.max(targetSpeed, window.VSC.Constants.SPEED_LIMITS.MIN),
      window.VSC.Constants.SPEED_LIMITS.MAX
    );

    targetSpeed = Number(targetSpeed.toFixed(2));

    this.setSpeed(video, targetSpeed, source);
  }

  getPreferredSpeed() {
    if (this.config.settings.rememberSpeed) {
      return this.config.settings.lastSpeed || 1.0;
    }
    return 1.0;
  }

  setSpeed(video, speed, source = 'internal') {
    const speedValue = speed.toFixed(2);
    const numericSpeed = Number(speedValue);

    if (source !== 'external' && source !== 'init') {
      this.config.settings.lastSpeed = numericSpeed;
    }

    if (this.eventManager) {
      this.eventManager.refreshCoolDown();
    }

    window.VSC.siteHandlerManager.handleSpeedChange(video, numericSpeed);

    video.dispatchEvent(
      new CustomEvent('ratechange', {
        bubbles: true,
        composed: true,
        detail: {
          origin: 'videoSpeed',
          speed: speedValue,
          source: source,
        },
      })
    );

    const speedIndicator = video.vsc?.speedIndicator;
    if (!speedIndicator) {
      window.VSC.logger.warn(
        'Cannot update speed indicator: video controller UI not fully initialized'
      );
      return;
    }
    speedIndicator.textContent = numericSpeed.toFixed(2);

    if (source !== 'external' && this.config.settings.rememberSpeed) {
      this.config.save({ lastSpeed: numericSpeed });
    }

    if (video.vsc?.div) {
      this.flashController(video.vsc.div);
    }
  }
}

window.VSC.ActionHandler = ActionHandler;