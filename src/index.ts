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
let savedFrequencyBytes: Uint8Array = new Uint8Array([
    62,67,65,53,42,47,45,50,45,29,27,42,47,34,20,8,
    18,21,12,3,1,19,53,72,70,51,49,45,41,39,32,36,35,
    29,26,31,32,23,21,12,21,21,8,8,13,25,34,42,45,46,
    45,50,56,58,64,65,71,79,76,74,79,78,84,95,96,92,
    89,102,115,111,111,102,96,83,74,74,68,69,75,74,
    71,75,78,72,56,41,38,37,31,30,49,69,72,66,64,59,
    63,59,55,46,39,28,12,0,0,0,17,32,44,57,56,49,53,56,41,44,48,59,55,50,55,62,67,83,97,118,137,142,132,110,95,85,78,69,55,42,29,33,48,47,36,28,9,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,17,26,21,13,0,4,9,14,13,12,48,74,88,91,82,63,49,46,39,26,32,31,27,19,7,0,9,8,12,8,12,10,0,0,0,0,8,26,39,39,38,39,34,31,29,27,24,25,25,33,43,48,49,52,59,67,75,85,98,107,119,138,158,167,164,147,121,109,102,99,96,94,86,81,73,70,64,61,58,63,67,67,59,55,56,57,52,42,71,86,85,74,65,60,59,57,60,56,55,57,60,53,53,56,57,59,66,70,72,76,80,90,111,128,134,124,102,72,61,64,54,32,16,10,7,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,12,29,36,34,60,87,100,101,93,74,50,41,33,22,23,15,8,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,13,18,7,9,11,23,47,64,67,54,31,12,12,0,0,0,4,4,0,0,0,6,5,22,48,63,62,49,29,19,15,12,20,14,0,0,3,4,0,0,0,0,0,2,2,0,0,0,0,0,0,11,12,12,7,4,14,29,37,34,20,3,0,0,0,0,0,0,3,1,0,0,0,0,17,28,33,35,21,14,7,4,7,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,16,35,45,41,22,10,2,2,11,7,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,5,11,10,11,8,0,0,5,13,21,17,6,16,11,0,0,5,7,11,10,17,26,36,44,60,72,73,62,45,31,18,5,2,0,0,0,4,11,0,3,7,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1,19,36,48,48,39,25,21,12,4,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,16,18,5,0,0,0,0,0,7,5,10,15,12,9,5,0,0,8,15,15,17,24,33,52,69,75,68,53,31,17,8,3,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,18,22,8,0,0,0,0,0,0,0,0,0,0,0,9,22,19,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,18,14,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,11,10,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
]);

let canvas: HTMLCanvasElement;
let canvasCtx: CanvasRenderingContext2D;
let timingCursor: HTMLDivElement;
let timingHitMarker: HTMLDivElement;
let timingHitDescription: HTMLDivElement;
let timingLeadUpInners: HTMLDivElement[];
let timingTargetInner: HTMLDivElement;

const canvasWidth = 400;
const canvasHeight = 200;

const foundItemFrequency = 230; // why did this change from 210?
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
    drawFrequencyGraph(savedFrequencyBytes, 1024);
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
    drawFrequencyGraph(dataArray, analyser.frequencyBinCount);

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

function drawFrequencyGraph(dataArray: Uint8Array, frequencyBinCount: number) {
    canvasCtx.fillStyle = "rgb(200,200,200)";
    canvasCtx.fillRect(0, 0, canvasWidth, canvasHeight);
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = "rgb(0,0,0)";

    canvasCtx.beginPath();
    const sliceWidth = canvasWidth / frequencyBinCount;
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
        console.log(`Max frequency: ${maxFrequency} (${audioContext.sampleRate / 2 * maxFrequency / dataArray.length} Hz). Amplitude: ${maxAmplitude}`);
    }

    // TODO: more robust method of signal identification? compare response from different mics?
    // 1. find all "significant enough" peaks.
    // 2. record this into some data structure.
    // 3. when a signal comes in, search again for its peaks, and fingerprint them against the target.
    // 4. allow incoming peaks to vary from the target, perhaps more tolerant if all the peaks have shifted a similar amount.
    if (Math.abs(maxFrequency - foundItemFrequency) <= 2 && maxAmplitude > 80) {
        savedFrequencyBytes = dataArray.slice();
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