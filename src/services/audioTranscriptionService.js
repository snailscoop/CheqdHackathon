/**
 * AudioTranscriptionService.js
 * A service for transcribing audio from videos using the Vosk speech recognition toolkit
 * via a Python script bridge.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * AudioTranscriber service
 */
class AudioTranscriptionService {
  constructor() {
    // Configuration settings
    this.config = {
      modelPath: process.env.VOSK_MODEL_PATH || path.join(process.cwd(), 'models', 'vosk-model-small-en-us-0.15'),
      pythonScript: process.env.VOSK_PYTHON_SCRIPT || path.join(process.cwd(), 'scripts', 'transcribe_audio.py'),
      tempDir: path.join(process.cwd(), 'processing', 'temp'),
      audioExtraction: {
        sampleRate: 16000,
        channels: 1,
        chunkSize: 4000
      }
    };
    
    // Initialize properties
    this.modelPath = this.config.modelPath;
    this.pythonScript = this.config.pythonScript;
    this.tempDir = this.config.tempDir;
    this.audioSampleRate = this.config.audioExtraction.sampleRate;
    this.audioChannels = this.config.audioExtraction.channels;
    this.chunkSize = this.config.audioExtraction.chunkSize;
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Initialize the transcription service
   * @returns {Promise<void>}
   */
  async initialize() {
    logger.info('Initializing Audio Transcription Service');
    
    // Check if Python script exists, create if not
    if (!fs.existsSync(this.pythonScript)) {
      logger.warn(`Python script not found: ${this.pythonScript}. Creating it.`);
      await this.createPythonScript();
    }
    
    // Check if the model directory exists
    if (!fs.existsSync(this.modelPath)) {
      logger.warn(`Vosk model not found: ${this.modelPath}. Please download it manually.`);
    }
  }

  /**
   * Create the Python script for transcription if it doesn't exist
   * @returns {Promise<void>}
   */
  async createPythonScript() {
    const scriptDir = path.dirname(this.pythonScript);
    if (!fs.existsSync(scriptDir)) {
      fs.mkdirSync(scriptDir, { recursive: true });
    }
    
    const pythonScriptContent = `#!/usr/bin/env python3
# transcribe_audio.py - Audio transcription script using Vosk

import argparse
import json
import os
import sys
import wave
import vosk
import time

def transcribe_audio(audio_path, model_path, chunk_size=4000):
    """
    Transcribe audio file using Vosk
    """
    result = {
        "success": False,
        "error": None,
        "results": [],
        "full_text": ""
    }
    
    try:
        # Check if model exists
        if not os.path.exists(model_path):
            result["error"] = f"Model not found: {model_path}"
            return result
        
        # Check if audio file exists
        if not os.path.exists(audio_path):
            result["error"] = f"Audio file not found: {audio_path}"
            return result
        
        # Load Vosk model
        model = vosk.Model(model_path)
        
        # Open audio file
        wf = wave.open(audio_path, "rb")
        
        # Check audio format
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getcomptype() != "NONE":
            result["error"] = "Audio file must be WAV format mono PCM"
            return result
        
        # Create recognizer
        recognizer = vosk.KaldiRecognizer(model, wf.getframerate())
        recognizer.SetWords(True)
        
        # Process audio in chunks
        full_text = []
        
        while True:
            data = wf.readframes(chunk_size)
            if len(data) == 0:
                break
            
            if recognizer.AcceptWaveform(data):
                part_result = json.loads(recognizer.Result())
                if part_result.get("text", "").strip():
                    part_result["time"] = wf.tell() / wf.getframerate()
                    result["results"].append(part_result)
                    full_text.append(part_result.get("text", ""))
        
        # Get final result
        part_result = json.loads(recognizer.FinalResult())
        if part_result.get("text", "").strip():
            part_result["time"] = wf.tell() / wf.getframerate()
            result["results"].append(part_result)
            full_text.append(part_result.get("text", ""))
        
        result["full_text"] = " ".join(full_text)
        result["success"] = True
        
    except Exception as e:
        result["error"] = str(e)
    
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Transcribe audio using Vosk")
    parser.add_argument("--audio", required=True, help="Path to audio file")
    parser.add_argument("--model", required=True, help="Path to Vosk model")
    parser.add_argument("--chunk-size", type=int, default=4000, help="Audio chunk size")
    
    args = parser.parse_args()
    
    result = transcribe_audio(args.audio, args.model, args.chunk_size)
    print(json.dumps(result))
`;
    
    fs.writeFileSync(this.pythonScript, pythonScriptContent);
    fs.chmodSync(this.pythonScript, '755');
    
    logger.info(`Created Python transcription script: ${this.pythonScript}`);
  }

  /**
   * Transcribe audio from a video file
   * @param {string} videoPath - Path to the video file
   * @returns {Promise<Object>} Object containing the transcription results
   */
  async transcribeVideo(videoPath) {
    logger.info(`Transcribing video: ${videoPath}`);
    
    try {
      // Extract audio from video
      const audioPath = await this.extractAudioFromVideo(videoPath);
      
      // Transcribe audio using the Python script
      const transcription = await this.transcribeAudio(audioPath);
      
      // Clean up temporary audio file
      this.cleanupFile(audioPath);
      
      return transcription;
    } catch (error) {
      logger.error(`Error transcribing video: ${error.message}`);
      // Return a fallback empty result
      return { 
        success: false, 
        error: error.message,
        results: [],
        full_text: ''
      };
    }
  }

  /**
   * Extract audio from a video file using ffmpeg
   * @param {string} videoPath - Path to the video file
   * @returns {Promise<string>} Path to the extracted audio file
   */
  async extractAudioFromVideo(videoPath) {
    const videoId = path.basename(videoPath, path.extname(videoPath));
    const audioPath = path.join(this.tempDir, `${videoId}_audio.wav`);
    
    logger.info(`Extracting audio to: ${audioPath}`);
    
    try {
      // Extract audio using ffmpeg with configured sample rate and channels
      const command = `ffmpeg -i "${videoPath}" -ar ${this.audioSampleRate} -ac ${this.audioChannels} -vn -y "${audioPath}"`;
      execSync(command);
      
      return audioPath;
    } catch (error) {
      logger.error(`Error extracting audio: ${error.message}`);
      throw new Error(`Failed to extract audio: ${error.message}`);
    }
  }

  /**
   * Transcribe audio using the Python Vosk script
   * @param {string} audioPath - Path to the audio file (WAV format)
   * @returns {Promise<Object>} Transcription results
   */
  async transcribeAudio(audioPath) {
    try {
      // Check if Python script exists
      if (!fs.existsSync(this.pythonScript)) {
        throw new Error(`Python script not found: ${this.pythonScript}`);
      }
      
      // Check if Vosk model exists
      if (!fs.existsSync(this.modelPath)) {
        throw new Error(`Vosk model not found: ${this.modelPath}`);
      }
      
      // Make sure the script is executable
      try {
        fs.chmodSync(this.pythonScript, '755');
      } catch (error) {
        logger.warn(`Could not make Python script executable: ${error.message}`);
      }
      
      // Run the Python script with chunk size from config
      const command = `python3 "${this.pythonScript}" --audio "${audioPath}" --model "${this.modelPath}" --chunk-size ${this.chunkSize}`;
      const output = execSync(command).toString();
      
      // Parse JSON output from the Python script
      try {
        const result = JSON.parse(output);
        
        if (!result.success) {
          throw new Error(result.error || 'Unknown error during transcription');
        }
        
        logger.info(`Transcription completed with ${result.results.length} segments`);
        return result;
      } catch (parseError) {
        logger.error(`Error parsing transcription output: ${parseError.message}`);
        logger.error(`Raw output: ${output}`);
        throw new Error('Failed to parse transcription output');
      }
    } catch (error) {
      logger.error(`Error running transcription: ${error.message}`);
      throw error;
    }
  }

  /**
   * Transcribe an audio buffer directly (for voice messages)
   * @param {Buffer} audioBuffer - Audio buffer in WAV format
   * @returns {Promise<Object>} Transcription results
   */
  async transcribeBuffer(audioBuffer) {
    try {
      const tempFilePath = path.join(this.tempDir, `temp_${Date.now()}.wav`);
      
      // Write buffer to temporary file
      fs.writeFileSync(tempFilePath, audioBuffer);
      
      // Transcribe the temporary file
      const result = await this.transcribeAudio(tempFilePath);
      
      // Clean up temporary file
      this.cleanupFile(tempFilePath);
      
      return result;
    } catch (error) {
      logger.error(`Error transcribing buffer: ${error.message}`);
      return { 
        success: false, 
        error: error.message,
        results: [],
        full_text: ''
      };
    }
  }

  /**
   * Clean up a temporary file
   * @param {string} filePath - Path to the file to delete
   */
  cleanupFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info(`Deleted temporary file: ${filePath}`);
      }
    } catch (error) {
      logger.warn(`Could not delete file ${filePath}: ${error.message}`);
    }
  }
}

module.exports = new AudioTranscriptionService(); 