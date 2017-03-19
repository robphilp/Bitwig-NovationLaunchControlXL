loadAPI(2);

function inArray(array, val) {
    return array.indexOf(val) !== -1
}

host.defineController("Novation", "Launch Control XL", "0.1", "af3eb537-06ce-4f2c-a3b3-47685bcaf356", "Robert Philp");
host.defineMidiPorts(1, 1);
// host.defineSysexIdentityReply('F0 7E 00 06 02 00 20 29 61 00 00 00 00 00 03 06 F7');

var blink = 0;
var blinkInterval;
var transport;
var tempo;
var trackBank;

function blinkTimer() {
    blink = 1 - blink;
    host.scheduleTask(blinkTimer, blinkInterval);
}

// We have a single row (1 scene) of 8 tracks represented by our 8 buttons on LaunchControl XL
var NUM_TRACKS = 8;
var NUM_SCENES = 1;

var USER_MODE_1 = 176;

var OFF = 0;
var ON = 127;

// MIDI values that we listen for in the onMidi listener
var BUTTON_UP = 104;
var BUTTON_DOWN = 105;
var BUTTON_LEFT = 106;
var BUTTON_RIGHT = 107;
var BUTTONS_DIRECTIONAL = [BUTTON_UP, BUTTON_DOWN, BUTTON_LEFT, BUTTON_RIGHT];

// Colour values that can be sent to the track focus/control buttons to represent some state
var BLACK = 0;
var YELLOW = 26;
var GREEN = 28;

// note values for track focus midi in/out
var TRACK_FOCUS_BUTTONS = [41, 42, 43, 44, 57, 58, 59, 60];
var TRACK_CONTROL_BUTTONS = [73, 74, 75, 76, 89, 90, 91, 92];

var VOLUME_FADERS = [77, 78, 79, 80, 81, 82, 83, 84];

/**
 * These represent one "row" of clips in the session view.
 * Each array holds a true/false value.
 * We use multiple arrays to fit with the "observer" event model.
 */
var clipHasContent = initArray(0, NUM_TRACKS * NUM_SCENES);
var clipIsPlaying = initArray(0, NUM_TRACKS * NUM_SCENES);
var clipIsQueuedForPlayback = initArray(0, NUM_TRACKS * NUM_SCENES);
var clipIsQueuedForStop = initArray(0, NUM_TRACKS * NUM_SCENES);

// soft takeover store for volume faders
var volume = initArray(0, NUM_TRACKS * NUM_SCENES);
for(i=0; i<NUM_TRACKS; i++) {
    volume[i] = {
        changes: false,
        jumps: false,
        value: 0
    }
}

// A function to create an indexed function for the Observers
function getValueObserverFunc(index, targetVariable) {
    return function(track, value) {
        targetVariable[index] = value;
    }
}

// A function to create an indexed function for the Observers
function getSoftTakeoverObserverFunc(index, targetVariable) {
    return function(value) {
        if (!targetVariable[index].changes) {
            targetVariable[index].jumps = true
        } else {
            targetVariable[index].changes = false
        }
        targetVariable[index].value = value;
    }
}

// Initialise - do all your setup in here!
function init() {
    transport = host.createTransport();
    transport.tempo().value().addRawValueObserver(function(t) {
        tempo = t;
        blinkInterval = 1000 / tempo * 60 /4;
    });
    host.scheduleTask(blinkTimer, blinkInterval);

    trackBank = host.createTrackBank(NUM_TRACKS, 3, 1);
    for (var t = 0; t < NUM_TRACKS; t++)
    {
        // clip observers
        trackBank.getChannel(t).clipLauncherSlotBank().setIndication(true);
        trackBank.getChannel(t).clipLauncherSlotBank().addHasContentObserver(getValueObserverFunc(t, clipHasContent));
        trackBank.getChannel(t).clipLauncherSlotBank().addIsPlayingObserver(getValueObserverFunc(t, clipIsPlaying));
        trackBank.getChannel(t).clipLauncherSlotBank().addIsPlaybackQueuedObserver(getValueObserverFunc(t, clipIsQueuedForPlayback));

        // track volume observers
        trackBank.getChannel(t).getVolume().modulatedValue().addValueObserver(128, getSoftTakeoverObserverFunc(t, volume))
    }

    // Callback for receiving MIDI input from our controller
    host.getMidiInPort(0).setMidiCallback(onMidi);
}

// Sends all our "outbound" MIDI data to update the controller visual state etc
function flush() {
    // This updates the "track focus" buttons representing the single row of clips in the session
    for (var i=0; i<NUM_TRACKS; i++) {
        colour = BLACK;
        if (clipHasContent[i] == 1) colour = YELLOW;
        if (clipIsQueuedForPlayback[i] == 1) (blink == 1) ? colour = GREEN : colour = BLACK;
        if (clipIsPlaying[i] == 1) colour = GREEN;
        host.getMidiOutPort(0).sendMidi(144, TRACK_FOCUS_BUTTONS[i], colour);
    }
}

/**
 * Respond to MIDI input from the controller.  At present, this branches out to other functions depending
 * on which sets of buttons are used. Just helps keep things modular.
 */
function onMidi(status, data1, data2) {
    // Debugging call - dumps MIDI data into console
    // printMidi(status, data1, data2);

    // Branches to other functions depending on input
    if (inArray(BUTTONS_DIRECTIONAL, data1)) {
       handleSessionControl(status, data1, data2);
    }
    if (inArray(TRACK_FOCUS_BUTTONS, data1)) {
        handleClipLaunch(status, data1, data2)
    }
    if (inArray(TRACK_CONTROL_BUTTONS, data1)) {
        handleClipStop(status, data1, data2)
    }
    if (inArray(VOLUME_FADERS, data1)) {
        handleVolumeFader(status, data1, data2);
    }
}

// Handles session movement/launch if the directional buttons are pressed
function handleSessionControl(status, data1, data2) {
    if (data1 == BUTTON_RIGHT && data2 == ON) {
        trackBank.sceneBank().getScene(0).launch();
    }
    if (data1 == BUTTON_DOWN && data2 == ON) {
        trackBank.sceneBank().scrollPageForwards();
    }
    if (data1 == BUTTON_UP && data2 == ON) {
        trackBank.sceneBank().scrollPageBackwards();
    }
}

// Handles individual clip launch if the track focus buttons are pressed
function handleClipLaunch(status, data1, data2) {
    track = TRACK_FOCUS_BUTTONS.indexOf(data1);
    if (track !== -1) trackBank.getChannel(track).clipLauncherSlotBank().getItemAt(0).launch();
}

// Handles individual clip stop if the track control buttons are pressed
function handleClipStop(status, data1, data2) {
    track = TRACK_CONTROL_BUTTONS.indexOf(data1);
    if (track !== -1) trackBank.getChannel(track).clipLauncherSlotBank().stop();
}

function handleVolumeFader(status, data1, data2) {
    track = VOLUME_FADERS.indexOf(data1);
    if (track !== -1) {
        var diff = data2 - volume[track].value;
        if (!volume[track].jumps || (Math.abs(diff) < 2)) {
            volume[track].changes = true;
            volume[track].jumps = false;
            trackBank.getChannel(track).getVolume().value().set(data2, 128);
        }
    }
}

function exit() {
    // nothing to see here :-)
}
