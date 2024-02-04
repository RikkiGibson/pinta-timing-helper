document.addEventListener('DOMContentLoaded', ready);

// TODO: Track and transition between event-mode and item-mode
// as cues go by.
// e.g. when a cue times out, move to event mode
// when event mode cue is hit, move to item mode
// when item mode cue is hit, move back to event mode
// perhaps when 3-beeps pattern is heard, move to event mode
// button/hotkey to switch between them manually as needed
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

let pendingAt: number;
let timingStartAt: number;

/**
 * Actual time minus target time that an event manip was hit.
 * Factored in to the duration of the subsequent item manip.
 * Positive means the event manip was late and the item manip should be shorter.
 * Negative means the event manip was early and the item manip should be longer.
 **/
let itemManipDelta = 0;


let audioContext: AudioContext;
let analyser: AnalyserNode;
let dataArray: Uint8Array;

let canvas: HTMLCanvasElement;
let canvasCtx: CanvasRenderingContext2D;

interface TimingVisualizerDynamicElements {
    timingMeter: HTMLDivElement;
    timingCursor: HTMLDivElement;
    timingHitMarker: HTMLDivElement;
    timingHitDescription: HTMLDivElement;
    timingLeadUpInners: HTMLDivElement[];
    timingTargetInner: HTMLDivElement;
}

let eventTimingElements: TimingVisualizerDynamicElements;
let itemTimingElements: TimingVisualizerDynamicElements;

/** speed at which the timing cursor moves */
const pixelsPerSecond = 82;

const canvasWidth = 200;
const canvasHeight = 140;

const fftSize = 2048;
const frequencyBinCount = fftSize / 2;

const foundItemFrequency = 210;

// these fingerprints probably need more harmonics in them.
// sounds like the disk drive and random clicking will set them off.
const gameStartFingerprint = [
    { frequency: 3750, amplitude: 95 },
    { frequency: 4429.6875, amplitude: 141 },
    { frequency: 5109.375, amplitude: 146 },
    { frequency: 5812.5, amplitude: 104 },
];

const closeMenuFingerprint = [
    //{ frequency: 4804.6875, amplitude: 158 },
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
    { frequency: 4875, amplitude: 126 },
    { frequency: 6070.3125, amplitude: 112 },
];

const bpm = 138;
const beatTime = 1 / (bpm / 60);
const toneDuration = 0.35;
const frameTime = 1 / 60; // i.e. 60fps

const eventTimingOptions = {
    foundItem: 1.3, // 🔉🔉🔉|🅰️🛑🛑🅱️
    tradeShip: 2.1, // 🔉🔉🔉|🅰️🛑🛑🛑|🛑🅱️
};

// TODO would like if the checklist were included directly in this tool.
// Maybe timing selection would be next to the relevant checklist items.
// e.g. maybe you need 3B->4B trades. Let's keep Found B Item next to that.
interface ItemTiming { event: 'foundItem' | 'tradeShip', name: string, timingSeconds: number };

const itemTimingOptionValues: ItemTiming[] = [
    { event: 'foundItem', name: 'B Item', timingSeconds: 3.43 }, // 🔉🛑🛑🛑|🛑🛑🛑🛑|🅰️
    
    { event: 'foundItem', name: 'Idol / Hat / Berzerker', timingSeconds: 6.1 }, // 🔉🛑🛑🛑|🛑🛑🛑🛑|🛑🛑🛑🛑|🛑🛑🅰️
    
    { event: 'foundItem', name: 'Moonberry / Con Gem', timingSeconds: 4.40 }, // 🔉🛑🛑🛑|🛑🛑🛑🛑|🛑🛑🅰️
    
    { event: 'foundItem', name: 'Wind Gem / Eye of Truth', timingSeconds: 1.55 }, // 🔉🛑🛑🅰️

    { event: 'tradeShip', name: 'Trade 3B->4B', timingSeconds: 2.14 }, // 🔉🛑🛑🛑|🛑🅰️

    // todo: this trade is clearly really hard to go for. Can we please find a found item manip which can give you con gems enough of the time that we can just focus on that?
    //{ event: 'tradeShip', name: 'Trade 3B->1A', timingSeconds: 4.47 }, // 🔉🛑🛑🛑|🛑🅰️ 4.36 is idol minus one measure. 4.4 is idol minus "almost one measure".
];

let selectedItemTiming: ItemTiming;

function getCurrentTimingSeconds() {
    return cueMode == TimingCueMode.Event ? eventTimingOptions[selectedItemTiming.event] : selectedItemTiming.timingSeconds;
}

function ready() {
    document.getElementById('start-stop-button')!
        .addEventListener('click', startOrStop);

    document.getElementById('reset-button')!
        .addEventListener('click', reset);

    document.getElementById('beep-button')!
        .addEventListener('click', onBeep);


    eventTimingElements = getTimingVisualizerElements(document.getElementById('event-timing-visualizer')!);
    itemTimingElements = getTimingVisualizerElements(document.getElementById('item-timing-visualizer')!);
    itemTimingElements.timingHitMarker.classList.add('hidden');

    const itemTimingOptions = document.getElementById('select-manips') as HTMLSelectElement;
    for (const option of itemTimingOptionValues) {
        itemTimingOptions.options.add(new Option(option.name));
    }
    const localStorageSelectedTimingName = localStorage.getItem('selected-timing-name');
    if (localStorageSelectedTimingName) {
        selectedItemTiming = itemTimingOptionValues.find(opt => opt.name == localStorageSelectedTimingName)!
    }
    selectedItemTiming = selectedItemTiming || itemTimingOptionValues[0];
    itemTimingOptions.addEventListener('change', onTimingSelected);
    itemTimingOptions.value = selectedItemTiming.name;

    adjustTimingMarkers();

    canvas = document.getElementById('frequency-graph') as HTMLCanvasElement;
    canvasCtx = canvas.getContext("2d")!;
    canvas.setAttribute('width', `${canvasWidth}`);
    canvas.setAttribute('height', `${canvasHeight}`);
    canvasCtx.fillStyle = "rgb(200,200,200)";
    canvasCtx.fillRect(0, 0, canvasWidth, canvasHeight);

    function getTimingVisualizerElements(timingVisualizer: HTMLElement): TimingVisualizerDynamicElements {
        const timingMeter = timingVisualizer.querySelector('.timing-meter') as HTMLDivElement;
        const timingCursor = timingVisualizer.querySelector('.timing-cursor') as HTMLDivElement;

        const timingHitMarker = timingVisualizer.querySelector('.timing-hit-marker') as HTMLDivElement;
        timingHitMarker.style.left = `${-timingHitMarker.clientWidth / 2}px`;

        const timingHitDescription = timingVisualizer.querySelector('.timing-hit-description') as HTMLDivElement;
        const timingLeadUpInners = [...timingVisualizer.querySelectorAll<HTMLDivElement>('.timing-lead-up-inner')];
        const timingTargetInner = timingVisualizer.querySelector('.timing-target-inner') as HTMLDivElement;

        return {
            timingMeter,
            timingCursor,
            timingHitDescription,
            timingHitMarker,
            timingLeadUpInners,
            timingTargetInner
        };
    }
}

// TODO: switch between FOUND ITEM and TRADE SHIP
// - offer different sets of options for each
// - actual detection for TRADE SHIP events
// - transition modes between manip'ing the event and manip'ing the item/trade
function onTimingSelected(ev: Event) {
    const selectManips = ev.target as HTMLSelectElement;
    selectedItemTiming = itemTimingOptionValues.find(elem => elem.name === selectManips.selectedOptions[0].text)!;
    localStorage.setItem('selected-timing-name', selectedItemTiming.name);
    adjustTimingMarkers();
}

function adjustTimingMarkers() {
    // event timing
    adjustTimingMarkers1(
        eventTimingOptions[selectedItemTiming.event],
        document.getElementById("event-timing-visualizer")!);

    // item timing
    adjustTimingMarkers1(
        selectedItemTiming.timingSeconds,
        document.getElementById("item-timing-visualizer")!);

    function adjustTimingMarkers1(timingSeconds: number, timingVisualizer: HTMLElement) {
        const width = `${pixelsPerSecond * timingSeconds}px`;
        const timingMeter = timingVisualizer.querySelector<HTMLDivElement>('.timing-meter')!;
        timingMeter.style.width = width;
        const timingIconsRow = timingVisualizer.querySelector<HTMLDivElement>('.timing-icons')!;
        timingIconsRow.style.width = width;
        const beatWidth = pixelsPerSecond * beatTime;

        const timingLines = timingVisualizer.querySelectorAll<HTMLElement>('.timing-line');
        timingLines[0].style.right = `${beatWidth * 3 - timingLines[0].clientWidth / 2}px`;
        timingLines[1].style.right = `${beatWidth * 2 - timingLines[1].clientWidth / 2}px`;
        timingLines[2].style.right = `${beatWidth - timingLines[2].clientWidth / 2}px`;
        timingLines[3].style.right = `${-timingLines[3].clientWidth / 2}px`;

        const timingIcons = timingVisualizer.querySelectorAll<HTMLElement>('.timing-icon');
        timingIcons[0].style.right = `${beatWidth * 3 - timingIcons[0].clientWidth / 2}px`;
        timingIcons[1].style.right = `${beatWidth * 2 - timingIcons[1].clientWidth / 2}px`;
        timingIcons[2].style.right = `${beatWidth - timingIcons[2].clientWidth / 2}px`;
        timingIcons[3].style.right = `${-timingIcons[3].clientWidth / 2}px`;
    }
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
    drawFrequencyGraph(dataArray);

    const { timingMeter, timingLeadUpInners, timingTargetInner, timingCursor, timingHitMarker } =
        cueMode == TimingCueMode.Event ? eventTimingElements : itemTimingElements;
    if (cueState == TimingCueState.CueingSecondTone || cueState == TimingCueState.HeardSecondTone) {
        const positionWithinMeasure = (pendingAt - audioContext.currentTime) % (beatTime * 4);
        if (Math.abs(positionWithinMeasure - beatTime * 3) <= frameTime) {
            timingTargetInner.classList.remove('timing-hit');
            timingLeadUpInners[0].classList.add('timing-hit');
        }

        if (Math.abs(positionWithinMeasure - beatTime * 2) <= frameTime) {
            timingLeadUpInners[0].classList.remove('timing-hit');
            timingLeadUpInners[1].classList.add('timing-hit');
        }
        
        if (Math.abs(positionWithinMeasure - beatTime * 1) <= frameTime) {
            timingLeadUpInners[1].classList.remove('timing-hit');
            timingLeadUpInners[2].classList.add('timing-hit');
        }
        
        if (Math.abs(positionWithinMeasure) <= frameTime) {
            timingLeadUpInners[2].classList.remove('timing-hit');
            timingTargetInner.classList.add('timing-hit');
        }
    }

    if (cueState == TimingCueState.CueingSecondTone) {
        const percentageComplete = (itemManipDelta + audioContext.currentTime - timingStartAt) / getCurrentTimingSeconds();
        const timingMeterWidth = timingMeter.clientWidth;
        const position = timingMeterWidth * percentageComplete;
        timingCursor.style.width = `${position}px`;
        timingHitMarker.style.left = `${position - timingHitMarker.clientWidth / 2}px`;
    }

    if (detectFingerprint(gameStartFingerprint)) {
        console.log("Heard game start tone. Resetting.");
        reset();
    } else if (detectTone()) {
        onBeep();
    } else if (cueState == TimingCueState.CueingSecondTone) {
        if (audioContext.currentTime > pendingAt + 1) {
            transitionCueState(TimingCueState.AwaitingFirstTone);
            console.log(`Did not hear response in time. Resetting to pending state.`);
        }
    } else if (cueState == TimingCueState.HeardSecondTone && audioContext.currentTime > pendingAt + 1.0) {
        // TODO: the trailing A presses tend to unexpectedly push us from event mode to item mode.
        // how can we prevent that?
        transitionCueState(TimingCueState.AwaitingFirstTone);
        console.log("Cue complete. Ready to hear new tone.");
    }
}

function reset() {
    for (const { timingCursor, timingHitDescription, timingHitMarker, timingLeadUpInners, timingTargetInner } of [eventTimingElements, itemTimingElements]) {
        timingCursor.style.width = '0';
        timingHitDescription.innerText = '';
        timingHitMarker.style.left = `${-timingHitMarker.clientWidth / 2}px`;
        timingLeadUpInners.forEach((elem) => elem.classList.remove('timing-hit'));
        timingTargetInner.classList.remove('timing-hit');
    }
    eventTimingElements.timingHitMarker.classList.remove('hidden');
    itemTimingElements.timingHitMarker.classList.add('hidden');
    cueMode = TimingCueMode.Event;
    cueState = TimingCueState.AwaitingFirstTone;
    timingStartAt = 0;
    pendingAt = 0;
    itemManipDelta = 0;
}

function transitionCueState(nextState: TimingCueState) {
    const { timingLeadUpInners, timingTargetInner, timingCursor, timingHitMarker, timingHitDescription } =
        cueMode == TimingCueMode.Event ? eventTimingElements : itemTimingElements;

    if (nextState == TimingCueState.AwaitingFirstTone) {
        timingCursor.style.width = '0';
        timingHitDescription.innerText = '';
        timingHitMarker.style.left = `${-timingHitMarker.clientWidth / 2}px`;
        timingLeadUpInners.forEach((elem) => elem.classList.remove('timing-hit'));
        timingTargetInner.classList.remove('timing-hit');
        if (cueMode == TimingCueMode.Event) {
            timingHitMarker.classList.add('hidden');
            itemTimingElements.timingHitMarker.classList.remove('hidden');
            itemTimingElements.timingHitMarker.style.left = `${itemManipDelta * pixelsPerSecond - itemTimingElements.timingHitMarker.clientWidth / 2}px`;
            itemTimingElements.timingHitDescription.innerText = itemManipDelta == 0 ? '' : `${itemManipDelta < 0 ? '-' : '+'}${Math.trunc(Math.abs(itemManipDelta*1000))}ms`;
            cueMode = TimingCueMode.Item;
        } else {
            timingHitMarker.classList.add('hidden');
            eventTimingElements.timingHitMarker.classList.remove('hidden');
            cueMode = TimingCueMode.Event;
        }
    } else if (nextState == TimingCueState.CueingSecondTone) {
        timingHitDescription.innerText = '';
        timingStartAt = audioContext.currentTime;
        const currentTimingSeconds = getCurrentTimingSeconds();
        pendingAt = timingStartAt + currentTimingSeconds - itemManipDelta;
        console.log(`Heard first tone ${audioContext.currentTime}. Scheduling cue sound for ${currentTimingSeconds}s`);
    } else if (nextState == TimingCueState.HeardSecondTone) {
        const difference = audioContext.currentTime - pendingAt;
        if (cueMode == TimingCueMode.Event) {
            // carry the difference on the event timing thru to the found item timing
            // todo: hit-marker should be shifted over before beep to indicate this
            // todo: when the timing is way off (more than 1s?) just drop the delta
            // possibly don't even move to item timing, user is probably resetting
            itemManipDelta = difference;
        } else {
            // don't carry the difference on item timing thru to event timing
            itemManipDelta = 0;
        }
        timingHitDescription.innerText = `${difference < 0 ? '-' : '+'}${Math.trunc(Math.abs(difference*1000))}ms`;
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

function getIndex(frequency: number): number {
    return frequency * frequencyBinCount * 2 / getSampleRate();
}

function getSampleRate(): number {
    return audioContext?.sampleRate ?? 48000;
}

// debugging
let debug = false;
let savedPeaks: { peaks: Peak[], dataArray: Uint8Array }[] = [];

function detectTone(): boolean {
    // debugging
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
        : selectedItemTiming.event == "tradeShip" && cueState == TimingCueState.AwaitingFirstTone
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
          k--------
          |   u        u
          |   |     ---|----k
          |   |    k   |    |
          |   |    |   |    |
          |   |    |   |    |
          k = "known peak" in signal, matching a fingerprint peak
          u = "unknown peak" in signal, not matching a fingerprint peak
          in the above, the first 'u' is good, the second 'u' is bad.

          All peaks in the incoming signal must meet the following:
          find the nearest "known peak" in the fingerprint which is lower in frequency kl, and the nearest which is higher in frequency kh
          take the higher of these two "known peaks". call it "largerKnownPeak".
          if no known peak exists with lower frequency, then treat the higher-frequency peak as larger, and same with if no known peak with higher frequency exists, take the lower-frequency peak as larger.
          for each unknown peak u, where kl.frequency < u < kh.frequency,
          largerKnownPeak.amplitude must be > than u.amplitude.
        */

        const frequencyTolerance = 2 * getSampleRate() / frequencyBinCount;

        const currentMatchingPeak = currentKnownPeak && findClosest(peaks, currentKnownPeak.frequency, frequencyTolerance);
        if (currentKnownPeak && !currentMatchingPeak) {
            return false;
        }
        
        // TODO: could avoid a little work by setting up largerMatchingPeak at the same time we check existence of current/prev here and above
        const previousMatchingPeak = previousKnownPeak && findClosest(peaks, previousKnownPeak.frequency, frequencyTolerance);
        if (previousKnownPeak && !previousMatchingPeak) {
            return false;
        }

        if (!currentMatchingPeak && !previousMatchingPeak) {
            throw "Found neither a currentMatchingPeak or a previousMatchingPeak but didn't return in earlier checks";
        }

        const largerMatchingPeak = !previousMatchingPeak ? currentMatchingPeak! :
            !currentMatchingPeak ? previousMatchingPeak! :
            // TODO: what if the amplitudes of the "previous matching" and "current matching" peaks do not meet this relation?
            // Should we say the signal is not a match in that case?
            previousKnownPeak.amplitude > currentKnownPeak.amplitude
                ? previousMatchingPeak
                : currentMatchingPeak;

        // we should be able to determine this by:
        // -for each known peak k, scan and see the previous known peak, or nothing, thus determining a frequency range in the input signal to scan, and a largestKnownPeak
        // -for each input frequency in this range, scan the amplitudes to ensure that all are smaller than largestKnownPeak.amplitude.
        const startIndex = previousMatchingPeak ? getIndex(previousMatchingPeak.frequency) : currentMatchingPeak!.frequency / 2;
        const endIndex = currentMatchingPeak ? getIndex(currentMatchingPeak.frequency) : Math.min(previousMatchingPeak!.frequency * 2, (getSampleRate() / 2));
        for (let j = startIndex; j < endIndex; j++) {
            // TODO: it's quite possible that we need more known peaks in the fingerprint
            // and to allow a match when simply *enough* of the peaks are matched.
            // for now, I'm permitting unknown peaks to slightly exceed known ones.
            if (largerMatchingPeak.amplitude < dataArray[j]) {
                /**
                         u
                ----|----k
                k   |    |
                |   |    |
                |   |    |
                Input signal has a peak between known peaks which is larger than amplitude of known peaks.
                This signal doesn't match the fingerprint.
                */
                return false;
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
        if (lastPeak && i - lastPeak.index < 2) {
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

    if (cueState == TimingCueState.CueingSecondTone && audioContext.currentTime > timingStartAt + toneDuration) {
        transitionCueState(TimingCueState.HeardSecondTone);
        return;
    }
}


function analyzeTone() {
    const oscillator = audioContext.createOscillator();
    oscillator.type = 'square';
    oscillator.frequency.value = 536;

    const gain = audioContext.createGain();
    gain.gain.value = 0.1;
    oscillator.connect(gain);
    gain.connect(analyser);
    gain.connect(audioContext.destination);
    oscillator.start();
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