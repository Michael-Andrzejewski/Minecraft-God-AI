import { AgentProcess } from './src/process/agent-process.js';
import settings from './settings.js';
import { readFileSync } from 'fs';
import fs from 'fs';
import path from 'path';

try {
  const profilePath = path.join(process.cwd(), 'city_maximizer.json');
  console.log('Attempting to load profile from:', profilePath);
  const profileData = fs.readFileSync(profilePath, 'utf8');
  const profile = JSON.parse(profileData);
  console.log('Profile loaded successfully:', profile);
  
  // Ensure the profile has the necessary fields
  if (!profile.model) {
    console.warn('No model specified in profile. Using default.');
    profile.model = 'gpt-3.5-turbo';
  }
  if (!profile.api) {
    console.warn('No API specified in profile. Using default.');
    profile.api = 'openai';
  }

  // Create the AgentProcess with the loaded profile
  const agentProcess = new AgentProcess();
  agentProcess.start(profile, settings.load_memory, settings.init_message);
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('Profile file not found. Please ensure the file exists at:', error.path);
  } else {
    console.error('Error loading profile:', error.message);
  }
  process.exit(1);
}
