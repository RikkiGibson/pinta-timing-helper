document.addEventListener('DOMContentLoaded', ready);

enum TimingCueMode {
    Event = "Event", // Found Item, Trade Ship
    Item = "Item",
}

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
let cueMode = TimingCueMode.Event;
let cueState = TimingCueState.AwaitingFirstTone;

/** contains the last time the reset tone was heard, or undefined if the reset tone has not been heard yet. */
let lastResetTime: number | undefined;

/** if {@link cueState} is {@link TimingCueState.CueingSecondTone}, contains the time that the second tone is expected. */
let pendingAt: number;
/** if {@link cueState} is {@link TimingCueState.CueingSecondTone}, contains the time that the first tone was heard. */
let timingStartAt: number;

let audioContext: AudioContext;
let analyser: AnalyserNode;
let dataArray: Uint8Array;

let canvas: HTMLCanvasElement;
let canvasCtx: CanvasRenderingContext2D;

interface TimingVisualizerDynamicElements {
    timingLeadUpMeter: { element: HTMLDivElement, time: number };
    timingMeterFilled: HTMLDivElement;
    timingCursor: HTMLDivElement;
    timingDescription: HTMLDivElement;
    timingMeasureIndicators: { element: HTMLDivElement, time: number }[];
    timingLeadUps: HTMLDivElement[];
    timingTarget: HTMLDivElement;
}

let eventTimingElements: TimingVisualizerDynamicElements;
let itemTimingElements: TimingVisualizerDynamicElements;

/** speed at which the timing cursor moves */
const pixelsPerSecond = 82;

const canvasWidth = 200;
const canvasHeight = 70;

const fftSize = 2048;
const frequencyBinCount = fftSize / 2;

const foundItemFrequency = 210;

const gameStartFingerprint = [
    { frequency: 5789.0625, amplitude: 218 },
    { frequency: 6492.1875, amplitude: 181 },
    { frequency: 7171.875, amplitude: 150 },
];

const closeMenuFingerprint = [
    { frequency: 5296.875, amplitude: 156 },
    { frequency: 5648.4375, amplitude: 150 },
    { frequency: 6000, amplitude: 135 },
];

const foundItemFingerprint = [
    { frequency: 4921.875, amplitude: 161 },
    { frequency: 6000, amplitude: 128 },
    { frequency: 7101.5625, amplitude: 88 },
];

const tradeShipFingerprint = [
    { frequency: 4851.5625, amplitude: 197 },
    { frequency: 5484.375, amplitude: 129 },
    { frequency: 6070.3125, amplitude: 182 },
];

const bpm = 138;
const beatTime = 1 / (bpm / 60);
const toneDuration = 0.35;
const frameTime = 1 / 60; // i.e. 60fps

const eventTimingOptions = {
    foundItem: 1.3, // 🔉🔉🔉|🅰️🛑🛑🅱️
    tradeShip: 2.1, // 🔉🔉🔉|🅰️🛑🛑🛑|🛑🅱️
};

interface ItemTiming { event: 'foundItem' | 'tradeShip', name: string, timingSeconds: number };

// The timings drift in PQ itself over time.
// The drift seems to be over a range of about 100-200ms, back and forth, gradually.
// Ideally the timings in here would be at around the midpoint of the real target range.
// some, like Trade 3B->4B, seem to tend toward being hit late, though.
const itemTimingOptionValues: ItemTiming[] = [
    // TODO: Ring, Seed, Idol timing are all too short. Maybe do some logging/adjustment to make them more on the dot.
    { event: 'foundItem', name: 'Ring (B A C)', timingSeconds: 1.55 }, // 🔉🛑🛑🅰️
    { event: 'foundItem', name: 'Seed (B A B)', timingSeconds: 4.48 }, // 🔉🛑🛑🛑|🛑🛑🛑🛑|🛑🛑🅰️
    { event: 'foundItem', name: 'Idol (C A B)', timingSeconds: 6.1 }, // 🔉🛑🛑🛑|🛑🛑🛑🛑|🛑🛑🛑🛑|🛑🛑🅰️
    { event: 'foundItem', name: 'Box', timingSeconds: 3.43 }, // 🔉🛑🛑🛑|🛑🛑🛑🛑|🅰️
    { event: 'foundItem', name: 'Victory (B A)', timingSeconds: 4.38 }, // 🔉🛑🛑🛑|🛑🛑🛑🛑|🛑🛑🅰️
    { event: 'tradeShip', name: '3B->4B', timingSeconds: 2.19 }, // 🔉🛑🛑🛑|🛑🅰️
    { event: 'tradeShip', name: '1B->4C', timingSeconds: 1.32 }, // 🔉🛑🛑🅰️

    // { event: 'tradeShip', name: 'Trade 3B->1A', timingSeconds: 4.47 }, // 🔉🛑🛑🛑|🛑🅰️ 4.36 is idol minus one measure. 4.4 is idol minus "almost one measure".
];

let selectItemTiming: HTMLSelectElement;
let selectedItemTiming: ItemTiming;

function getCurrentTimingSeconds() {
    return cueMode == TimingCueMode.Event ? eventTimingOptions[selectedItemTiming.event] : selectedItemTiming.timingSeconds;
}

function ready() {
    document.getElementById('start-stop-button')!
        .addEventListener('click', startOrStop);

    document.getElementById('reset-button')!
        .addEventListener('click', () => reset(true));

    document.getElementById('beep-button')!
        .addEventListener('click', onBeep);

    document.addEventListener('keydown', onKey);

    eventTimingElements = makeTimingVisualizerElements(document.getElementById('event-timing-visualizer')!);
    itemTimingElements = makeTimingVisualizerElements(document.getElementById('item-timing-visualizer')!);

    selectItemTiming = document.getElementById('select-manips') as HTMLSelectElement;
    for (const option of itemTimingOptionValues) {
        selectItemTiming.options.add(new Option(option.name));
    }

    selectItemTiming.size = selectItemTiming.options.length;

    const localStorageSelectedTimingName = localStorage.getItem('selected-timing-name');
    if (localStorageSelectedTimingName) {
        selectedItemTiming = itemTimingOptionValues.find(opt => opt.name == localStorageSelectedTimingName)!
    }
    selectedItemTiming = selectedItemTiming || itemTimingOptionValues[0];
    selectItemTiming.addEventListener('change', onTimingSelected);
    selectItemTiming.value = selectedItemTiming.name;

    adjustTimingMarkers();

    const clockPredictionNotch = document.getElementById('clock-prediction-notch')!;
    clockPredictionNotch.classList.add('hidden');

    canvas = document.getElementById('frequency-graph') as HTMLCanvasElement;
    canvasCtx = canvas.getContext("2d")!;
    canvas.setAttribute('width', `${canvasWidth}`);
    canvas.setAttribute('height', `${canvasHeight}`);
    canvasCtx.fillStyle = "rgb(200,200,200)";
    canvasCtx.fillRect(0, 0, canvasWidth, canvasHeight);

    function makeTimingVisualizerElements(timingVisualizer: HTMLElement): TimingVisualizerDynamicElements {
        const timingLeadUpMeter = timingVisualizer.querySelector('.timing-lead-up-meter') as HTMLDivElement;
        const timingMeterFilled = timingVisualizer.querySelector('.timing-meter-filled') as HTMLDivElement;

        const timingCursor = timingVisualizer.querySelector('.timing-hit-marker') as HTMLDivElement;
        timingCursor.classList.add('hidden');

        const timingDescription = timingVisualizer.querySelector('.timing-description') as HTMLDivElement;
        const timingLeadUps = [...timingVisualizer.querySelectorAll<HTMLDivElement>('.timing-lead-up')];
        const timingTarget = timingVisualizer.querySelector('.timing-target') as HTMLDivElement;

        return {
            timingLeadUpMeter: { element: timingLeadUpMeter, time: 0 },
            timingMeterFilled,
            timingDescription,
            timingCursor,
            timingMeasureIndicators: [],
            timingLeadUps,
            timingTarget
        };
    }
}

function onKey(ev: KeyboardEvent) {
    if (ev.code === 'Minus') {
        reset(true);
        return;
    }

    if (ev.code === 'Equal') {
        onBeep();
        return;
    }

    if (ev.code === 'BracketLeft' && selectItemTiming.selectedIndex > 0) {
        selectItemTiming.selectedIndex--;
        onTimingSelected();
        return;
    }

    if (ev.code === 'BracketRight' && selectItemTiming.selectedIndex < selectItemTiming.options.length - 1) {
        selectItemTiming.selectedIndex++;
        onTimingSelected();
        return;
    }
}

function onTimingSelected() {
    selectedItemTiming = itemTimingOptionValues.find(elem => elem.name === selectItemTiming.selectedOptions[0].text)!;
    localStorage.setItem('selected-timing-name', selectedItemTiming.name);
    adjustTimingMarkers();
}

function adjustTimingMarkers() {
    // event timing
    adjustTimingMarkers1(
        eventTimingOptions[selectedItemTiming.event],
        document.getElementById("event-timing-visualizer")!,
        eventTimingElements);

    // item timing
    adjustTimingMarkers1(
        selectedItemTiming.timingSeconds,
        document.getElementById("item-timing-visualizer")!,
        itemTimingElements);

    function adjustTimingMarkers1(timingSeconds: number, timingVisualizer: HTMLElement, dynamicElements: TimingVisualizerDynamicElements) {
        const beatWidth = pixelsPerSecond * beatTime;

        // Clear previous "measure indicators" and repopulate if needed
        const timingMeter = timingVisualizer.querySelector<HTMLDivElement>('.timing-meter')!;
        timingMeter.querySelectorAll('.timing-measure-indicator').forEach(node => node.remove());
        dynamicElements.timingMeasureIndicators = [];

        if (timingSeconds > beatTime * 6) {
            dynamicElements.timingLeadUpMeter.time = beatTime * 3;
            insertMeasureIndicators(timingSeconds - dynamicElements.timingLeadUpMeter.time);
        } else {
            // timing is short enough to just use the lead-up indicator to represent the whole timing
            dynamicElements.timingLeadUpMeter.time = timingSeconds;
        }

        const timingLeadUpMeter = timingVisualizer.querySelector<HTMLDivElement>('.timing-lead-up-meter')!;
        timingLeadUpMeter.style.width = `${pixelsPerSecond * dynamicElements.timingLeadUpMeter.time}px`;
        timingLeadUpMeter.querySelectorAll('.timing-line').forEach(node => node.remove());
        
        // insert line per each beat of the lead up meter
        for (let currentTime = 0; currentTime < dynamicElements.timingLeadUpMeter.time; currentTime += beatTime) {
            const line = makeTimingLine();
            timingLeadUpMeter.appendChild(line);
            const position = currentTime * pixelsPerSecond - line.clientWidth / 2;
            line.style.right = `${position}px`;
        }
        
        const timingIcons = timingVisualizer.querySelectorAll<HTMLElement>('.timing-icon');
        timingIcons[0].style.right = `${beatWidth * 3 - timingIcons[0].clientWidth / 2}px`;
        timingIcons[1].style.right = `${beatWidth * 2 - timingIcons[1].clientWidth / 2}px`;
        timingIcons[2].style.right = `${beatWidth - timingIcons[2].clientWidth / 2}px`;
        timingIcons[3].style.right = `${-timingIcons[3].clientWidth / 2}px`;

        function insertMeasureIndicators(remainingMeasureIndicatorsTime: number) {
            const firstMeasureTime = remainingMeasureIndicatorsTime % (beatTime * 4);
            remainingMeasureIndicatorsTime -= firstMeasureTime;

            const firstMeasureIndicator = makeTimingMeasureIndicator();
            const percentage = firstMeasureTime / (beatTime * 4);
            
            // reduce the area of the circle by the percentage
            // ignore pi, it's just proportional to square of radius
            const baseArea = 16 * 16;
            const newArea = baseArea * percentage;
            const newRadius = Math.round(Math.sqrt(newArea));

            const size = `${newRadius}px`;
            firstMeasureIndicator.style.width = size;
            firstMeasureIndicator.style.height = size;

            dynamicElements.timingMeasureIndicators.push({ element: firstMeasureIndicator, time: firstMeasureTime });
            timingMeter.insertBefore(firstMeasureIndicator, dynamicElements.timingLeadUpMeter.element);

            while (remainingMeasureIndicatorsTime >= (beatTime * 4 - 1e-5)) {
                const measureIndicator = makeTimingMeasureIndicator();
                dynamicElements.timingMeasureIndicators.push({ element: measureIndicator, time: beatTime * 4 });
                timingMeter.insertBefore(measureIndicator, dynamicElements.timingLeadUpMeter.element);
                remainingMeasureIndicatorsTime -= beatTime * 4;
            }
            if (remainingMeasureIndicatorsTime > 1e-5) {
                throw new Error(`Too much remaining measure indicators time '${remainingMeasureIndicatorsTime}'.`);
            }
        }
    }

    function makeTimingLine(): HTMLDivElement {
        var timingLine = document.createElement('div');
        timingLine.classList.add('timing-line');
        return timingLine;
    }
}

function makeTimingMeasureIndicator(): HTMLDivElement {
    const measureIndicator = document.createElement('div');
    measureIndicator.classList.add('timing-measure-indicator');

    return measureIndicator;
}

async function startOrStop() {
    if (running) {
        running = false;
        await audioContext.close();
        audioContext = null!;
        reset(true);
        return;
    }

    if (cueMode != TimingCueMode.Event) {
        throw new Error(`Unexpected starting cueMode '${cueMode}'`);
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

    reset(true);
    requestAnimationFrame(onFrame);
}

function onFrame() {
    if (!running) {
        return;
    }

    if (document.hasFocus()) {
        document.body.classList.remove('unfocused');
    } else {
        document.body.classList.add('unfocused');
    }

    requestAnimationFrame(onFrame);
    analyser.getByteFrequencyData(dataArray);
    drawFrequencyGraph(dataArray);

    const { timingLeadUpMeter, timingLeadUps, timingTarget, timingMeasureIndicators, timingMeterFilled, timingCursor } =
        cueMode == TimingCueMode.Event ? eventTimingElements : itemTimingElements;
    if (cueState == TimingCueState.CueingSecondTone || cueState == TimingCueState.HeardSecondTone) {
        const remainingTime = pendingAt - audioContext.currentTime;
        // we target beat 4 with our timings, not beat 1, so we want to shift the remainingTime forward by a beat before we take the remainder.
        const remainingInMeasure = (remainingTime + beatTime) % (beatTime * 4);
        const progressInMeasure = beatTime * 4 - remainingInMeasure;
        if (progressInMeasure < beatTime) {
            timingTarget.classList.remove('timing-hit');
            timingLeadUps[0].classList.add('timing-hit');
        }
        else if (progressInMeasure < beatTime * 2) {
            timingLeadUps[0].classList.remove('timing-hit');
            timingLeadUps[1].classList.add('timing-hit');
        }
        else if (progressInMeasure < beatTime * 3) {
            timingLeadUps[1].classList.remove('timing-hit');
            timingLeadUps[2].classList.add('timing-hit');
        }
        else {
            timingLeadUps[2].classList.remove('timing-hit');
            timingTarget.classList.add('timing-hit');
        }
    }

    if (cueState == TimingCueState.CueingSecondTone) {
        // fill measures
        let remainingTime = audioContext.currentTime - timingStartAt;
        let i = 0;
        for (const { element, time } of timingMeasureIndicators) {
            if (remainingTime < time) {
                // not enough to fill this one
                break;
            }

            element.classList.add('timing-hit');
            remainingTime -= time;
            i++;
        }

        if (i == timingMeasureIndicators.length) {
            // filled all the measure indicators, start filling the lead up meter
            const percentageComplete = remainingTime / timingLeadUpMeter.time;
            const timingMeterWidth = timingLeadUpMeter.element.clientWidth;
            const position = timingMeterWidth * percentageComplete;
            timingMeterFilled.style.width = `${position}px`;
            timingCursor.style.left = `${position - timingCursor.clientWidth / 2}px`;
        }

    }

    if (cueState == TimingCueState.AwaitingFirstTone && detectFingerprint(gameStartFingerprint)) {
        reset(false);
    } else if (detectTone()) {
        onBeep();
    } else if (cueState == TimingCueState.CueingSecondTone) {
        if (audioContext.currentTime > pendingAt + 1) {
            // if we miss the second tone on the item cue, stay on the item cue.
            // the first tone of it might have been a false positive and player wants another shot at it.
            transitionCueState(TimingCueState.AwaitingFirstTone, TimingCueMode.Item);
            console.log(`Did not hear response in time. Resetting to ${TimingCueMode.Item} ${TimingCueState.AwaitingFirstTone}.`);
        }
    } else if (cueState == TimingCueState.HeardSecondTone && audioContext.currentTime > pendingAt + 1.0) {
        transitionCueState(TimingCueState.AwaitingFirstTone);
        console.log("Cue complete. Ready to hear new tone.");
    }
}

function showClockPredictionNotch() {
    const clockPredictionNotch = document.getElementById('clock-prediction-notch')!;
    clockPredictionNotch.classList.remove('hidden');

    const clockHand = document.getElementById('clock-hand')!;
    const style = window.getComputedStyle(clockHand, null);
    clockPredictionNotch.style.transform = style.getPropertyValue('transform');
}

/**
 * @param manual false if the reset was triggered by an audio cue; otherwise, true.
 */
function reset(manual: boolean) {
    if (!manual) {
        if (!running) {
            throw new Error("Audio cues should only trigger an event if an audio context is running");
        }

        const currentTime = audioContext.currentTime;
        if (lastResetTime !== undefined
            && currentTime > lastResetTime
            && currentTime - lastResetTime < beatTime * 4) {
            // Ignore an auto-reset if the most recent one was in the too recent past.
            return;
        }

        console.log("Heard game start tone. Resetting.");
        lastResetTime = audioContext.currentTime;
    }

    for (const { timingMeterFilled, timingDescription, timingMeasureIndicators, timingLeadUps, timingTarget } of [eventTimingElements, itemTimingElements]) {
        timingMeterFilled.style.width = '0';
        timingDescription.innerText = '';
        timingLeadUps.forEach((elem) => elem.classList.remove('timing-hit'));
        timingMeasureIndicators.forEach((elem) => elem.element.classList.remove('timing-hit'));
        timingTarget.classList.remove('timing-hit');
    }

    const clockHand = document.getElementById('clock-hand')!;
    if (running) {
        clockHand.classList.add('rotating');
        eventTimingElements.timingCursor.classList.remove('hidden');
        eventTimingElements.timingCursor.style.left = `${-eventTimingElements.timingCursor.clientWidth / 2}px`;
    } else {
        clockHand.classList.remove('rotating');
        eventTimingElements.timingCursor.classList.add('hidden');
    }

    const clockPredictionNotch = document.getElementById('clock-prediction-notch')!;
    if (!running || manual) {
        clockPredictionNotch.classList.add('hidden');
    } else {
        clockPredictionNotch.classList.remove('hidden');
        const style = window.getComputedStyle(clockHand, null);
        clockPredictionNotch.style.transform = style.getPropertyValue('transform');
    }

    itemTimingElements.timingCursor.classList.add('hidden');
    cueMode = TimingCueMode.Event;
    cueState = TimingCueState.AwaitingFirstTone;
    timingStartAt = 0;
    pendingAt = 0;
}

function transitionCueState(nextState: TimingCueState, nextCueMode?: TimingCueMode) {
    const { timingLeadUps, timingTarget, timingMeasureIndicators, timingMeterFilled, timingCursor, timingDescription } =
        cueMode == TimingCueMode.Event ? eventTimingElements : itemTimingElements;

    if (nextCueMode && nextState != TimingCueState.AwaitingFirstTone) {
        throw new Error("Cue mode should only transition when moving to AwaitingFirstTone cue state");
    }

    if (nextState == TimingCueState.AwaitingFirstTone) {
        nextCueMode = nextCueMode ?? (cueMode == TimingCueMode.Event ? TimingCueMode.Item : TimingCueMode.Event);
        timingMeterFilled.style.width = '0';
        timingDescription.innerText = '';
        timingCursor.style.left = `${-timingCursor.clientWidth / 2}px`;
        timingLeadUps.forEach((elem) => elem.classList.remove('timing-hit'));
        timingMeasureIndicators.forEach((elem) => elem.element.classList.remove('timing-hit'));
        timingTarget.classList.remove('timing-hit');
        if (nextCueMode == TimingCueMode.Item) {
            timingCursor.classList.add('hidden');
            // TODO: extract this remove-hidden, rationalize the way we recenter this element after showing it
            itemTimingElements.timingCursor.classList.remove('hidden');

            // when no measure indicators, can offset the cursor based on previous cue error.
            // But when there *are* measure indicators it's confusing/not necessary.
            itemTimingElements.timingCursor.style.left = `${-itemTimingElements.timingCursor.clientWidth / 2}px`;
            itemTimingElements.timingDescription.innerText = '';
            cueMode = nextCueMode;
        } else {
            timingCursor.classList.add('hidden');
            eventTimingElements.timingCursor.classList.remove('hidden');
            cueMode = nextCueMode;
        }
    } else if (nextState == TimingCueState.CueingSecondTone) {
        timingDescription.innerText = '';
        timingStartAt = audioContext.currentTime;
        const currentTimingSeconds = getCurrentTimingSeconds();
        pendingAt = timingStartAt + currentTimingSeconds;
        console.log(`Heard first tone ${audioContext.currentTime}. Scheduling cue sound for ${currentTimingSeconds}s`);
    } else if (nextState == TimingCueState.HeardSecondTone) {
        const difference = audioContext.currentTime - pendingAt;
        timingDescription.innerText = `${difference < 0 ? '-' : '+'}${Math.trunc(Math.abs(difference*1000))}ms`;
        console.log(`Heard second tone at ${audioContext.currentTime} (expected at ${pendingAt})`);
    }
    cueState = nextState;
}

function drawFrequencyGraph(dataArray: Uint8Array) {
    canvasCtx.fillStyle = "rgb(200,200,200)";
    canvasCtx.fillRect(0, 0, canvasWidth, canvasHeight);
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = "rgb(0,0,0)";

    canvasCtx.beginPath();
    const sliceWidth = canvasWidth / frequencyBinCount;
    let x = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128.0; // dataArray values are between 0-255. This is a weird way to normalize them to the canvas area but, whatever.
        const y = canvasHeight - (v * canvasHeight / 2);

        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }

        x += sliceWidth;
    }

    canvasCtx.stroke();

    for (const peak of findPeaks(dataArray, 80)) {
        const x = peak.index * sliceWidth;
        const v = peak.amplitude / 128.0;
        const y = canvasHeight - (v * canvasHeight / 2);

        const size = 5;
        canvasCtx.fillStyle = "rgb(255,0,0)";
        canvasCtx.beginPath();
        canvasCtx.moveTo(x-size, y-size);
        canvasCtx.lineTo(x+size, y-size);
        canvasCtx.lineTo(x, y);
        canvasCtx.fill();
    }
}

function getFrequency(index: number): number {
    return getSampleRate() / 2 * index / frequencyBinCount;
}

function getSampleRate(): number {
    return audioContext?.sampleRate ?? 48000;
}

// debugging
let debug = false;
let savedPeaks: { peaks: Peak[], dataArray: Uint8Array }[] = [];

function debugIndex(index: number, fingerprint?: any): boolean {
    if (!debug) throw new Error("Set 'debug = true' first");

    dataArray = savedPeaks[index].dataArray;
    drawFrequencyGraph(dataArray);
    return detectFingerprint(fingerprint || foundItemFingerprint);
}

function detectTone(): boolean {
    if (debug) {
        let maxIndex = 0;
        let maxAmplitude = 0;

        for (let i = 0; i < dataArray.length; i++) {
            if (dataArray[i] > maxAmplitude) {
                maxIndex = i;
                maxAmplitude = dataArray[i];
            }
        }
        if (maxIndex > 0 && maxAmplitude > 70) {
                console.log(`Max frequency: ${maxIndex} (${getFrequency(maxIndex)} Hz). Amplitude: ${maxAmplitude} Time: ${audioContext.currentTime} Index: ${savedPeaks.length}`);
                savedPeaks.push({ peaks: findPeaks(dataArray), dataArray: dataArray.slice() });
        }
    }

    const fingerprint =
        cueMode == TimingCueMode.Event && cueState == TimingCueState.CueingSecondTone
        ? closeMenuFingerprint
        : cueMode == TimingCueMode.Item && selectedItemTiming.event == "tradeShip" && cueState == TimingCueState.AwaitingFirstTone
            ? tradeShipFingerprint
            : foundItemFingerprint;

    return detectFingerprint(fingerprint);
}

function detectFingerprint(fingerprint: { frequency: number, amplitude: number }[]): boolean {
    const peaks = findPeaks(dataArray);
    for (let i = 0; i <= fingerprint.length; i++)
    {
        const currentKnownPeak = i == fingerprint.length ? null : fingerprint[i];
        const previousKnownPeak = i == 0 ? null : fingerprint[i-1];
        /**
                   k
             u     |
          k--|-----|
          |  |     |
          |  |  u  |
          |  |  |  |
          k = "known peak" in signal, matching a fingerprint peak
          u = "unknown peak" in signal, not matching a fingerprint peak
          in the above, the first 'u' is too high, the second 'u' is acceptable.
        */

        const frequencyTolerance = 2 * getSampleRate() / frequencyBinCount;

        const currentMatchingPeak = currentKnownPeak && findClosest(peaks, currentKnownPeak.frequency, frequencyTolerance);
        if (currentKnownPeak && !currentMatchingPeak) {
            return false;
        }
        
        const previousMatchingPeak = previousKnownPeak && findClosest(peaks, previousKnownPeak.frequency, frequencyTolerance);
        if (previousKnownPeak && !previousMatchingPeak) {
            return false;
        }

        if (!currentMatchingPeak && !previousMatchingPeak) {
            throw new Error("Found neither a currentMatchingPeak or a previousMatchingPeak but didn't return in earlier checks");
        }

        if (previousMatchingPeak && currentMatchingPeak) {
            const expectedRatio = previousKnownPeak.amplitude / currentKnownPeak.amplitude;
            const actualRatio = previousMatchingPeak.amplitude / currentMatchingPeak.amplitude;
            if (Math.abs(expectedRatio - actualRatio) > 0.25) {
                // The amplitude ratio between known peaks needs to be pretty close to
                // the same ratio between matching peaks. Here they are too far apart.
                return false;
            }
        }

        const smallerMatchingPeak = !previousMatchingPeak ? currentMatchingPeak! :
            !currentMatchingPeak ? previousMatchingPeak! :
            previousMatchingPeak.amplitude > currentMatchingPeak.amplitude
                ? currentMatchingPeak
                : previousMatchingPeak;

        if (previousMatchingPeak) {
            const startIndex = previousMatchingPeak.index + 1;

            // For the last peak of the fingerprint, verify that no higher-frequency harmonics have higher amplitude
            // If they did, this would go against our expectations for the harmonic signature of a square wave.
            const endIndex = currentMatchingPeak ? currentMatchingPeak.index - 1 : frequencyBinCount;

            for (const peak of peaks) {
                if (peak.index < startIndex) {
                    continue;
                }
                if (peak.index >= endIndex) {
                    break;
                }

                if (smallerMatchingPeak.amplitude < peak.amplitude) {
                    /**
                             k  
                        u    |
                    k---|----|
                    |   |    |
                    |   |    |
                    Input signal has a peak between known peaks which is larger than amplitude of known peaks.
                    This signal doesn't match the fingerprint.
                    */
                    return false;
                }
            }
        }
    }

    return true;
}

// Finds the peak in 'signalPeaks' whose frequency is closest to 'targetFrequency' and within 'tolerance'
function findClosest(signalPeaks: Peak[], targetFrequency: number, tolerance: number): Peak | null {
    var closest = signalPeaks.length == 0 ? null : signalPeaks.reduce((prev, curr) =>
        Math.abs(prev.frequency - targetFrequency) < Math.abs(curr.frequency - targetFrequency)
            ? prev : curr);
    if (closest && Math.abs(closest.frequency - targetFrequency) < tolerance) {
        return closest;
    } else {
        return null;
    }
}

/** When peaks are closer than this it means they should be merged */
const peakMergeThreshold = 2;

interface Peak { frequency: number, index: number, amplitude: number };
function findPeaks(frequencyData: Uint8Array, threshold?: number): Peak[] {

    const peaks: Peak[] = [];
    for (let i = 1; i < frequencyData.length - 1; i++) {
        const current = frequencyData[i];
        const previous = frequencyData[i-1];
        const next = frequencyData[i+1];
        if ((threshold != null && current < threshold) || current <= previous || current <= next) {
            continue;
        }

        const lastPeak = peaks[peaks.length - 1];
        if (lastPeak && i - lastPeak.index < peakMergeThreshold) {
            // peaks are too close, take whichever of the two is bigger
            if (lastPeak.amplitude > current) {
                continue; // drop the current peak
            } else {
                peaks.pop(); // drop lastPeak
            }
        }
        peaks.push({ frequency: getFrequency(i), index: i, amplitude: current });
    }
    return peaks;
}

function onBeep() {
    if (!audioContext) return;

    if (cueState == TimingCueState.AwaitingFirstTone) {
        transitionCueState(TimingCueState.CueingSecondTone);
        return;
    }

    if (cueState == TimingCueState.CueingSecondTone && Math.abs(pendingAt - audioContext.currentTime) < 0.2) {
        transitionCueState(TimingCueState.HeardSecondTone);
        return;
    }
}
