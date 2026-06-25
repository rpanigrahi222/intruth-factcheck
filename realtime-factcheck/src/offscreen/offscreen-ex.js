// offscreen.js
// Captures tab audio via tabCapture and streams to Deepgram WebSocket.
// Deepgram handles transcription — no Web Speech API.

const DEEPGRAM_KEY = '';

let mediaStream = null;
let audioContext = null;
let processor = null;
let socket = null;
let active = false;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE') {
    startCapture(msg.streamId, msg.language || 'en')
      .then(() => sendResponse({ ok: true }))
      .catch(err => {
        console.error('[offscreen] error:', err);
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (msg.type === 'STOP_CAPTURE') {
    stopCapture();
    sendResponse({ ok: true });
  }
});

let utteranceBuffer = '';
let utteranceSpeakerCounts = {}; // track speaker word counts across buffer chunks

async function startCapture(streamId, language = 'en') {
  if (active) stopCapture();
  active = true;

  // get tab audio stream
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  // connect deepgram websocket
  socket = new WebSocket(
    'wss://api.deepgram.com/v1/listen?' + [
      'encoding=linear16',
      'sample_rate=16000',
      'channels=1',
      'model=nova-2',
      'language=' + language,
      'punctuate=true',
      'interim_results=true',
      'utterance_end_ms=2500',
      'smart_format=true',
      'vad_events=true',
      'diarize=true',
    ].join('&'),
    ['token', DEEPGRAM_KEY]
  );

  socket.onopen = () => {
    console.log('[offscreen] deepgram connected');
    startAudioPipeline();
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // handle utterance end event
      if (data.type === 'UtteranceEnd') {
        chrome.runtime.sendMessage({ type: 'UTTERANCE_END' });
        return;
      }

      const result = data.channel?.alternatives?.[0];
      if (!result || !result.transcript) return;

      const text    = result.transcript.trim();
      const isFinal = data.is_final;
      const speech  = data.speech_final;

      // accumulate speaker word counts from every chunk
      if (result.words?.length) {
        result.words.forEach(w => {
          if (w.speaker !== null && w.speaker !== undefined) {
            utteranceSpeakerCounts[w.speaker] = (utteranceSpeakerCounts[w.speaker] || 0) + 1;
          }
        });
      }

      // dominant speaker = whoever had the most words in this utterance so far
      function getDominantSpeaker() {
        const entries = Object.entries(utteranceSpeakerCounts);
        if (!entries.length) return null;
        return parseInt(entries.sort((a, b) => b[1] - a[1])[0][0]);
      }

      if (!text) return;

      if (isFinal && speech) {
        // speech_final = end of utterance — send full accumulated text as final
        const fullText = utteranceBuffer ? utteranceBuffer + ' ' + text : text;
        const speaker  = getDominantSpeaker();
        utteranceBuffer = '';
        utteranceSpeakerCounts = {};
        chrome.runtime.sendMessage({
          type:    'TRANSCRIPT_RESULT',
          text:    fullText.trim(),
          isFinal: true,
          interim: false,
          speaker,
        });
      } else if (isFinal && !speech) {
        // is_final but not speech_final — accumulate and show as interim
        utteranceBuffer += (utteranceBuffer ? ' ' : '') + text;
        chrome.runtime.sendMessage({
          type:    'TRANSCRIPT_RESULT',
          text:    utteranceBuffer,
          isFinal: false,
          interim: true,
          speaker: getDominantSpeaker(),
        });
      } else {
        // regular interim — show as-is
        chrome.runtime.sendMessage({
          type:    'TRANSCRIPT_RESULT',
          text,
          isFinal: false,
          interim: true,
          speaker: getDominantSpeaker(),
        });
      }

    } catch (err) {
      console.error('[offscreen] message parse error:', err);
    }
  };

  socket.onerror = (err) => {
    console.error('[offscreen] deepgram error:', err);
    chrome.runtime.sendMessage({ type: 'PIPELINE_ERROR', message: 'Transcription error — check your Deepgram key.' }).catch(() => {});
  };
  socket.onclose = (e) => {
    console.log('[offscreen] deepgram closed:', e.code, e.reason);
    if (e.code === 1008 || e.code === 1011) {
      // auth error or server error — don't reconnect, notify user
      chrome.runtime.sendMessage({ type: 'PIPELINE_ERROR', message: 'Deepgram connection failed (code ' + e.code + '). Check your API key.' }).catch(() => {});
      return;
    }
    if (active) {
      chrome.runtime.sendMessage({ type: 'PIPELINE_ERROR', message: 'Transcription disconnected — reconnecting...' }).catch(() => {});
      // request a fresh stream ID from service worker instead of reusing expired one
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'REQUEST_NEW_STREAM' }).catch(() => {});
      }, 1000);
    }
  };
}

function startAudioPipeline() {
  audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(mediaStream);

  // reconnect so user still hears video
  source.connect(audioContext.destination);

  processor = audioContext.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    if (socket?.readyState !== WebSocket.OPEN) return;

    const float32 = e.inputBuffer.getChannelData(0);

    // convert float32 to int16 for Deepgram
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
    }

    socket.send(int16.buffer);
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
  console.log('[offscreen] audio pipeline started');
}

function stopCapture() {
  active = false;
  utteranceBuffer = '';
  utteranceSpeakerCounts = {};

  if (socket) {
    socket.close();
    socket = null;
  }

  if (processor) {
    processor.disconnect();
    processor = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  console.log('[offscreen] stopped');
}