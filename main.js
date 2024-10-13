import { AgentProcess } from './src/process/agent-process.js';
import settings from './settings.js';
import { readFileSync } from 'fs';
import fs from 'fs';
import path from 'path';

let profiles = settings.profiles;
let load_memory = settings.load_memory;
let init_message = settings.init_message;

try {
  const profilePath = path.join(process.cwd(), 'city_maximizer.json');
  console.log('Attempting to load profile from:', profilePath);
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  console.log('Profile loaded successfully:', profile);
  
  // Create the AgentProcess with the loaded profile
  const agentProcess = new AgentProcess(profile);
  // ... rest of the code ...
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('Profile file not found. Please ensure the file exists at:', error.path);
  } else {
    console.error('Error loading profile:', error.message);
  }
  process.exit(1);
}

for (let profile of profiles)
    new AgentProcess().start(profile, load_memory, init_message);