document.addEventListener('DOMContentLoaded', ready);

enum TimingCueState {
    AwaitingFirstTone = "AwaitingFirstTone",
    CueingSecondTone = "CueingSecondTone",
    HeardSecondTone = "HeardSecondTone",

    // state transitions
    // AwaitingFirstTone->CueingSecondTone when the first tone is heard
    // CueingSecondTone->HeardSecondTone when the second tone is heard
    // CueingSecondTone->AwaitingFirstTone a bit after the cue is completed
    // HeardSecondTone->AwaitingFirstTone a bit after the cue is completed
}

let running = false;
let cueState = TimingCueState.AwaitingFirstTone;
let pendingAt: number;
let timingStartAt: number;
let audioContext: AudioContext;
let analyser: AnalyserNode;
let dataArray: Uint8Array;

let canvas: HTMLCanvasElement;
let canvasCtx: CanvasRenderingContext2D;
let timingCursor: HTMLDivElement;
let timingHitMarker: HTMLDivElement;
let timingHitDescription: HTMLDivElement;
let timingLeadUpInners: HTMLDivElement[];
let timingTargetInner: HTMLDivElement;

const canvasWidth = 400;
const canvasHeight = 200;

const foundItemFrequency = 210;
const bpm = 138;
const beatTime = 1 / (bpm / 60);
const toneDuration = 0.3;
const frameTime = 1 / 60; // i.e. 60fps

// note: actual time between beeps must be between 6.02-6.1.
// got a-item when over by 261ms
// const idolTimeSeconds = 5.8; // 🔉🛑🛑🛑|🛑🛑🛑🛑|🛑🛑🛑🛑|🛑🛑🅰️

const idolTimeSeconds = 6.06;
// const idolTimeSeconds = beatTime * 4;

function ready() {
    const button = document.getElementById('start-stop-button')!;
    button.addEventListener('click', startOrStop);

    document.getElementById('beep-button')!
        .addEventListener('click', onBeep);

    timingCursor = document.getElementById('timing-cursor') as HTMLDivElement;
    timingHitMarker = document.getElementById('timing-hit-marker') as HTMLDivElement;
    timingHitDescription = document.getElementById('timing-hit-description') as HTMLDivElement;
    timingLeadUpInners = [...document.querySelectorAll<HTMLDivElement>('.timing-lead-up-inner')];
    timingTargetInner = document.getElementById('timing-target-inner') as HTMLDivElement;;

    const timingMeterWidth = document.querySelector('.timing-meter')!.clientWidth;
    const beatWidth = timingMeterWidth * beatTime / idolTimeSeconds;

    timingHitMarker.style.left = `${-timingHitMarker.clientWidth / 2}px`;

    const timingLines = document.querySelectorAll<HTMLElement>('.timing-line');
    timingLines[0].style.right = `${beatWidth * 3 - timingLines[0].clientWidth / 2}px`;
    timingLines[1].style.right = `${beatWidth * 2 - timingLines[1].clientWidth / 2}px`;
    timingLines[2].style.right = `${beatWidth - timingLines[2].clientWidth / 2}px`;
    timingLines[3].style.right = `${-timingLines[3].clientWidth / 2}px`;

    const timingIcons = document.querySelectorAll<HTMLElement>('.timing-icon');
    timingIcons[0].style.right = `${beatWidth * 3 - timingIcons[0].clientWidth / 2}px`;
    timingIcons[1].style.right = `${beatWidth * 2 - timingIcons[1].clientWidth / 2}px`;
    timingIcons[2].style.right = `${beatWidth - timingIcons[2].clientWidth / 2}px`;
    timingIcons[3].style.right = `${-timingIcons[3].clientWidth / 2}px`;

    canvas = document.getElementById('frequency-graph') as HTMLCanvasElement;
    canvasCtx = canvas.getContext("2d")!;
    canvas.setAttribute('width', `${canvasWidth}`);
    canvas.setAttribute('height', `${canvasHeight}`);
    canvasCtx.fillStyle = "rgb(200,200,200)";
    canvasCtx.fillRect(0, 0, canvasWidth, canvasHeight);
}

async function startOrStop() {
    if (running) {
        running = false;
        audioContext.close();
        audioContext = null!;
        return;
    }

    running = true;
    if (!audioContext) audioContext = new AudioContext();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const mediaSource = audioContext.createMediaStreamSource(stream);

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    mediaSource.connect(analyser);
    requestAnimationFrame(onFrame);
}

function onFrame() {
    if (!running) {
        return;
    }

    requestAnimationFrame(onFrame);
    analyser.getByteFrequencyData(dataArray);
    drawFrequencyGraph();

    if (cueState == TimingCueState.CueingSecondTone || cueState == TimingCueState.HeardSecondTone) {
        if (Math.abs((pendingAt - beatTime * 3) - audioContext.currentTime) <= frameTime) {
            timingLeadUpInners[0].classList.add('timing-hit');
        }

        if (Math.abs((pendingAt - beatTime * 2) - audioContext.currentTime) <= frameTime) {
            timingLeadUpInners[1].classList.add('timing-hit');
        }

        if (Math.abs((pendingAt - beatTime * 1) - audioContext.currentTime) <= frameTime) {
            timingLeadUpInners[2].classList.add('timing-hit');
        }

        if (Math.abs(pendingAt - audioContext.currentTime) <= frameTime) {
            timingTargetInner.classList.add('timing-hit');
        }
    }

    if (cueState == TimingCueState.CueingSecondTone) {
        const percentageComplete = (audioContext.currentTime - timingStartAt) / idolTimeSeconds;
        const timingMeterWidth = document.querySelector('.timing-meter')!.clientWidth;
        const position = timingMeterWidth * percentageComplete;
        timingCursor.style.width = `${position}px`;
        timingHitMarker.style.left = `${position - timingHitMarker.clientWidth / 2}px`;

        if (Math.abs((pendingAt - beatTime * 3) - audioContext.currentTime) <= frameTime) {
            timingLeadUpInners[0].classList.add('timing-hit');
        }

        if (Math.abs((pendingAt - beatTime * 2) - audioContext.currentTime) <= frameTime) {
            timingLeadUpInners[1].classList.add('timing-hit');
        }

        if (Math.abs((pendingAt - beatTime * 1) - audioContext.currentTime) <= frameTime) {
            timingLeadUpInners[2].classList.add('timing-hit');
        }

        if (Math.abs(pendingAt - audioContext.currentTime) <= frameTime) {
            timingTargetInner.classList.add('timing-hit');
        }
    }

    // TODO: detect startup "3-beeps". add "rolling cues" for found item and trade ship.
    if (detectTone()) {
        onBeep();
    }
    else if (cueState == TimingCueState.CueingSecondTone) {
        if (audioContext.currentTime > pendingAt + 1) {
            transitionCueState(TimingCueState.AwaitingFirstTone);
            console.log(`Did not hear response in time. Resetting to pending state.`);
        }
    }
    else if (cueState == TimingCueState.HeardSecondTone && audioContext.currentTime > pendingAt + 1.0) {
        transitionCueState(TimingCueState.AwaitingFirstTone);
        console.log("Cue complete. Ready to hear new tone.");
    }
}

function transitionCueState(nextState: TimingCueState) {
    if (nextState == TimingCueState.AwaitingFirstTone) {
        timingCursor.style.width = '0';
        timingHitDescription.innerText = '';
        timingHitMarker.style.left = `${-timingHitMarker.clientWidth / 2}px`;
        timingLeadUpInners.forEach((elem) => elem.classList.remove('timing-hit'));
        timingTargetInner.classList.remove('timing-hit');
    } else if (nextState == TimingCueState.CueingSecondTone) {
        timingStartAt = audioContext.currentTime;
        pendingAt = timingStartAt + idolTimeSeconds;
        console.log(`Heard first tone. Scheduling cue sound for ${idolTimeSeconds}s`);
    } else if (nextState == TimingCueState.HeardSecondTone) {
        const difference = audioContext.currentTime - pendingAt;
        if (difference < 0) {
            console.log(`Second tone was early by ${Math.trunc(difference*-1000)}ms`);
        } else if (difference > 0) {
            console.log(`Second tone was late by ${Math.trunc(difference*1000)}ms`);
        } else {
            console.log(`Second tone was exactly on time..how did you do that?`);
        }
        timingHitDescription.innerText = `${difference < 0 ? '-' : '+'}${Math.trunc(Math.abs(difference*1000))}ms`;
    }
    cueState = nextState;
}

function drawFrequencyGraph() {
    canvasCtx.fillStyle = "rgb(200,200,200)";
    canvasCtx.fillRect(0, 0, canvasWidth, canvasHeight);
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = "rgb(0,0,0)";

    canvasCtx.beginPath();
    const sliceWidth = canvasWidth / analyser.frequencyBinCount;
    let x = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128.0; // TODO what does this 128 mean?
        const y = canvasHeight - (v * canvasHeight / 2);

        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }

        x += sliceWidth;
    }

    canvasCtx.stroke();
}

function detectTone(): boolean {
    let maxFrequency = 0;
    let maxAmplitude = 0;

    for (let i = 0; i < dataArray.length; i++) {
        if (dataArray[i] > maxAmplitude) {
            maxFrequency = i;
            maxAmplitude = dataArray[i];
        }
    }

    if (maxFrequency > 0 && maxAmplitude > 100) {
        //console.log(`Max frequency: ${maxFrequency} (${audioContext.sampleRate / 2 * maxFrequency / dataArray.length} Hz). Amplitude: ${maxAmplitude}`);
    }

    // TODO: more robust method of signal identification? compare response from different mics?
    if (Math.abs(maxFrequency - foundItemFrequency) <= 2 && maxAmplitude > 80) {
        return true;
    }

    return false;
}

function onBeep() {
    if (!audioContext) return;

    if (cueState == TimingCueState.AwaitingFirstTone) {
        transitionCueState(TimingCueState.CueingSecondTone);
        return;
    }

    if (cueState == TimingCueState.CueingSecondTone && audioContext.currentTime > timingStartAt + toneDuration) {
        transitionCueState(TimingCueState.HeardSecondTone);
        return;
    }
}

function beep(when: number, frequency: number) {
    const oscillator = audioContext.createOscillator();
    oscillator.type = 'square';
    oscillator.frequency.value = frequency;

    const gain = audioContext.createGain();
    gain.gain.value = 0.5;

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start(when);
    oscillator.stop(when + .01);
}