Change the destination output device in Web Audio

François Beaufort
Until now, setting the destination audio output device was only possible for <video> and <audio> with HTMLMediaElement.setSinkId(). In Web Audio, AudioContext used the default device, leaving the user to change the system audio output device manually.

From Chrome 110, you can use AudioContext.setSinkId() to programmatically direct the audio output in Web Audio to any permitted device.

This is especially helpful in a variety of real-time communication scenarios. For example, a web app can use this to programmatically direct output to a specific audio output device such as a Bluetooth headset or speakerphone.

Route audio output to a specific device
First, you need the identifier of the audio output device you want to use as a destination. Get the list of available media devices with navigator.mediaDevices.enumerateDevices(), filter on audio output devices only, and get the deviceId attribute of the audio output device of your choice. The empty string "" value can also be used as the default device for deviceId.

Note: The list of media devices is exhaustive when the "microphone" permission is granted by the user. The list consists of default devices only when this permission is not granted. You can request this permission by calling navigator.mediaDevices.getUserMedia({ audio: true }).
Once you have the identifier of the audio output device, create an AudioContext and call audioContext.setSinkId(deviceId). On success, the returned promise resolves when the audio is routed to the chosen connected output device. It can fail if the AudioContext is closed.

The example below shows you how to request microphone access if needed and direct the audio output in Web Audio to the first available output device.


const permission = await navigator.permissions.query({ name: "microphone" });
if (permission.state == "prompt") {
  // More audio outputs are available when user grants access to the mic.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

// Request a list of media devices and filter audio output devices.
const devices = await navigator.mediaDevices.enumerateDevices();
const audioOutputs = devices.filter(device => device.kind == "audiooutput");

const audioContext = new AudioContext();

// Pick the first available audio output.
const deviceId = audioOutputs[0].deviceId;
await audioContext.setSinkId(deviceId);
Note that you can also pass the deviceId as a sinkId parameter when creating an AudioContext.


const audioContext = new AudioContext({ sinkId: deviceId });
Render audio with a muted AudioContext
You can now specify a "silent output device" in Web Audio to minimize the power consumption. This time, instead of a string value, pass { type: "none" } to AudioContext.setSinkId().

Note that the audio clock accessible through audioContext.currentTime will still advance to render the audio graph. The main goal of this muted AudioContext is to render the audio graph without producing audible sound. The primary use case would be analyzing microphone input without making sounds.


// Silent Web Audio output.
await audioContext.setSinkId({ type: "none" });
Feature detection
To check if AudioContext.setSinkId() is supported, use:


if ("setSinkId" in AudioContext.prototype) {
  // AudioContext.setSinkId() is supported.
}
Sample
A demo is available at https://codepen.io/web-dot-dev/pen/emNwEaN/ to play with AudioContext.setSinkId().

Browser support
AudioContext.setSinkId() is available in Chrome 110 or later.