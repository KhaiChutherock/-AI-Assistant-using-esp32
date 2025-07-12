import express from 'express';
import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import WebSocket from 'ws';
import querystring from 'querystring';
import crypto from 'crypto';

const app = express();
const port = 3000;

const recordFile = path.resolve('recording.wav');
const voicedFile = path.resolve('voicedby.wav');

let shouldDownloadFile = false;
const maxTokens = 30; // defines the length of GPT response

// Google Gemini API configuration
const genAI = new GoogleGenerativeAI('AIzaSyCIgn00haDgHZDgaCZGep2wbBfwRCAKwC0'); // Your Google API key
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Middleware for data processing in a "multipart/form-data" format
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

app.post('/uploadAudio', (req, res) => {
  shouldDownloadFile = false;
  let recordingFile = fs.createWriteStream(recordFile, { encoding: 'utf8' });

  req.on('data', (data) => {
    recordingFile.write(data);
  });

  req.on('end', async () => {
    recordingFile.end();
    const transcription = await speechToTextAPI();
    res.status(200).send(transcription);
    callGemini(transcription);
  });
});


// Handler for checking the value of a variable
app.get('/checkVariable', (req, res) => {
	res.json({ ready: shouldDownloadFile });
});

// File upload handler
app.get('/broadcastAudio', (req, res) => {

	fs.stat(voicedFile, (err, stats) => {
		if (err) {
			console.error('File not found');
			res.sendStatus(404);
			return;
		}

		res.writeHead(200, {
			'Content-Type': 'audio/wav',
			'Content-Length': stats.size
		});

		const readStream = fs.createReadStream(voicedFile);
		readStream.pipe(res);

		readStream.on('end', () => {
			//console.log('File has been sent successfully');
		});

		readStream.on('error', (err) => {
			console.error('Error reading file', err);
			res.sendStatus(500);
		});
	});
});


app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});

// Speech-to-text API call
async function speechToTextAPI() {
  try {
    const base64Buffer = fs.readFileSync('recording.wav');
    const base64AudioFile = base64Buffer.toString('base64');

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'audio/wav',
          data: base64AudioFile, // Using `data` for Base64 data
        },
      },
      { text: 'Generate a transcript of the speech.' },
    ]);

    console.log('YOU:', result.response.text());
    return result.response.text(); // Return transcription text
  } catch (error) {
    console.error('Error during speech-to-text conversion:', error);
    throw error;
  }
}

async function callGemini(transcription) {
  try {
    const response = await model.generateContent([
      {
        text: `Hãy trả lời như một người bạn thân thiện và hỗ trợ. và ngắn gọn nhưng giới hạn câu trả lời trong 50 từ. Câu hỏi của tôi là: "${transcription}"`,
      },
    ]);

    const aiResponse = response.response.text();
    console.log("Gemini Response:", aiResponse);
    convertTextToSpeech(aiResponse); // Pass the Gemini response to TTS API
    return aiResponse;
  } catch (error) {
    console.error("Error while calling Gemini API:", error);
    throw error;
  }
}

function convertTextToSpeech(text) {
  const host = 'tts-api-sg.xf-yun.com';
  const APPID = 'ga553c08'; // Replace with your APPID
  const APIKey = '9ebbcdb3e56f73e1ee5779bd80653561'; // Replace with your API Key
  const APISecret = '36179f9dcff3c5b754d2ee820edd8733'; // Replace with your API Secret

  const wsParam = new WsParam(host, APPID, APIKey, APISecret, text);
  const websocketUrl = wsParam.createUrl();
  const ws = new WebSocket(websocketUrl, { perMessageDeflate: false });

  let audioBuffer = Buffer.alloc(0); // Khởi tạo buffer để lưu âm thanh

  ws.on('message', onMessage);
  ws.on('error', onError);
  ws.on('close', onClose);
  ws.on('open', onOpen);

  function onMessage(message) {
    try {
      const messageObj = JSON.parse(message);
  
      const { audio, status } = messageObj.data;
      const audioBase64 = Buffer.from(audio, 'base64');
      console.log("Received audio frame");
  
      // Ghi âm thanh vào buffer
      audioBuffer = Buffer.concat([audioBuffer, audioBase64]);
  
      if (status === STATUS_LAST_FRAME) {
        writeWavFile('voicedby.wav', audioBuffer);
        audioBuffer = Buffer.alloc(0); // Reset buffer
        ws.close();
      }
    } catch (e) {
      console.error("Failed to process message:", e);
    }
  }
  

  function onError(error) {
    console.log('### error:', error);
  }

  function onClose() {
    console.log('### closed ###');
  }

  function onOpen() {
    const d = {
      common: wsParam.CommonArgs,
      business: wsParam.BusinessArgs,
      data: wsParam.Data,
    };
    const dStr = JSON.stringify(d);
    console.log('------>Start sending data');
    ws.send(dStr);
  }
}

// WebSocket Parameters for TTS
class WsParam {
  constructor(host, APPID, APIKey, APISecret, Text) {
    this.Host = host;
    this.APPID = APPID;
    this.APIKey = APIKey;
    this.APISecret = APISecret;
    this.Text = Text;
    this.CommonArgs = { app_id: this.APPID };
    this.BusinessArgs = { aue: 'raw', auf: 'audio/L16;rate=16000', vcn: 'xiaoyun', tte: 'utf8' };
    this.Data = { status: 2, text: Buffer.from(this.Text).toString('base64') };
  }

  createUrl() {
    const date = new Date().toUTCString();
    const signatureOrigin = `host: ${this.Host}\ndate: ${date}\nGET /v2/tts HTTP/1.1`;
    const signatureSha = crypto.createHmac('sha256', this.APISecret).update(signatureOrigin).digest('base64');
    const authorizationOrigin = `api_key="${this.APIKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureSha}"`;
    const authorization = Buffer.from(authorizationOrigin).toString('base64');
    const v = {
      authorization,
      date,
      host: this.Host,
    };
    const websocketUrl = `wss://${this.Host}/v2/tts?${querystring.stringify(v)}`;
    return websocketUrl;
  }
}

const STATUS_FIRST_FRAME = 0;
const STATUS_CONTINUE_FRAME = 1;
const STATUS_LAST_FRAME = 2;

function writeWavFile(fileName, pcmBuffer, sampleRate = 16000, numChannels = 1) {
  const header = Buffer.alloc(44);

  // RIFF chunk descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4); // File size - 8 bytes
  header.write('WAVE', 8);

  // fmt sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // Audio format (1 for PCM)
  header.writeUInt16LE(numChannels, 22); // Number of channels
  header.writeUInt32LE(sampleRate, 24); // Sample rate
  header.writeUInt32LE(sampleRate * numChannels * 2, 28); // Byte rate
  header.writeUInt16LE(numChannels * 2, 32); // Block align
  header.writeUInt16LE(16, 34); // Bits per sample

  // data sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40); // Data size

  // Combine header and PCM data
  const wavBuffer = Buffer.concat([header, pcmBuffer]);

  // Write to file
  fs.writeFileSync(fileName, wavBuffer);
  console.log(`${fileName} has been written.`);

  shouldDownloadFile = true; // Thêm dòng này 
}
