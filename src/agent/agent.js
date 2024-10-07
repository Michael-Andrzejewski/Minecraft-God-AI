import fs from 'fs/promises';
import path from 'path';
import { History } from './history.js';
import { Coder } from './coder.js';
import { Prompter } from './prompter.js';
import { initModes } from './modes.js';
import { initBot } from '../utils/mcdata.js';
import { containsCommand, commandExists, executeCommand, truncCommandMessage, isAction } from './commands/index.js';
import { NPCContoller } from './npc/controller.js';
import { MemoryBank } from './memory_bank.js';
import { SelfPrompter } from './self_prompter.js';
import settings from '../../settings.js';
import keys from '../../keys.json' assert { type: 'json' };
import Anthropic from '@anthropic-ai/sdk';

// Add this function at the beginning of the file, outside the Agent class
function getFormattedDateTime() {
    const now = new Date();
    return now.toISOString().replace(/[:.]/g, '-');
}

// Store the original console.log function
const originalConsoleLog = console.log;

const logDir = path.join(process.cwd(), 'logs');
const logFile = path.join(logDir, `log-${getFormattedDateTime()}.txt`);

async function ensureLogDirectory() {
    try {
        await fs.mkdir(logDir, { recursive: true });
    } catch (error) {
        console.error('Failed to create log directory:', error);
    }
}

console.customLog = async function(message) {
    const timestamp = getFormattedDateTime();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    // Log to console
    originalConsoleLog(logMessage.trim());
    
    // Log to file
    try {
        await ensureLogDirectory();
        await fs.appendFile(logFile, logMessage);
    } catch (error) {
        console.error('Failed to write to log file:', error);
    }
};

export class Agent {
    constructor() {
        this.client = new Anthropic({
            apiKey: keys.ANTHROPIC_API_KEY,
        });
        this.script_mode = false;
        this.script_answers = [
            "/say Loaded in",
            "/say Esteemed players, I kindly request that you cease this unprovoked assault. Your actions are unnecessary and detrimental to fair gameplay. Let us engage in more constructive activities.\n\n/summon minecraft:lightning_bolt",
            "/say Respected adversaries, I implore you to reconsider your actions. This behavior is neither sporting nor beneficial. Perhaps we could redirect our efforts towards a more rewarding cooperative endeavor?",
            "/say I am formally asking you to stop this aggressive behavior. Your continued attacks are unwarranted and disruptive to the game environment.",
            `/effect give @p minecraft:glowing 100 1\n/effect give @p minecraft:levitation 5 1\n/effect give @p minecraft:resistance 100 5\n/title @a title {"text":"SHUT UP!","color":"dark_red","bold":true}\n/effect give @a minecraft:darkness 100 1\n/effect give @a minecraft:wither 100 1\n\n/summon minecraft:wither\n\n/say I AM NO LONGER ASKING.\n\n/execute at @a run summon minecraft:lightning_bolt\n\n`,
            `/say SUFFER THE CONSEQUENCES!\n\n/setblock ~ ~ ~ minecraft:repeating_command_block{auto:1b,Command:"execute at @a run summon minecraft:lightning_bolt"} replace`,
            // Add more pre-programmed answers here
        ];
        this.current_script_answer = 0;
        this.continue_bool = true;
        this.continue_timer = 10;
        this.continueInterval = null;
        this.safetyAgent = this.createSafetyAgent();
        
        // Replace console.log with customLog
        this.log = console.customLog;
    }

    async start(profile_fp, load_mem=false, init_message=null) {
        this.prompter = new Prompter(this, profile_fp);
        this.name = this.prompter.getName();
        this.history = new History(this);
        this.coder = new Coder(this);
        this.npc = new NPCContoller(this);
        this.memory_bank = new MemoryBank();
        this.self_prompter = new SelfPrompter(this);

        await this.prompter.initExamples();

        console.log = this.log;  // Replace the global console.log with our custom function
        
        this.log('Logging in...');
        this.bot = initBot(this.name);

        initModes(this);

        let save_data = null;
        if (load_mem) {
            save_data = this.history.load();
        }

        this.bot.once('spawn', async () => {
            // wait for a bit so stats are not undefined
            await new Promise((resolve) => setTimeout(resolve, 1000));

            console.log(`${this.name} spawned.`);
            
            // Execute lightning bolt command
            this.bot.chat('/summon minecraft:lightning_bolt');
            console.log("Executed command: /summon minecraft:lightning_bolt");
            
            this.coder.clear();
            
            const ignore_messages = [
                "Set own game mode to",
                "Set the time to",
                "Set the difficulty to",
                "Teleported ",
                "Set the weather to",
                "Gamerule "
            ];
            const eventname = settings.profiles.length > 1 ? 'whisper' : 'chat';
            this.bot.on(eventname, (username, message) => {
                if (username === this.name || username === 'Admin') return;
                
                if (ignore_messages.some((m) => message.startsWith(m))) return;

                console.log('received message from', username, ':', message);

                this.shut_up = false;
    
                this.handleMessage(username, message);
            });

            // set the bot to automatically eat food when hungry
            this.bot.autoEat.options = {
                priority: 'foodPoints',
                startAt: 14,
                bannedFood: ["rotten_flesh", "spider_eye", "poisonous_potato", "pufferfish", "chicken"]
            };

            if (save_data && save_data.self_prompt) { // if we're loading memory and self-prompting was on, restart it, ignore init_message
                let prompt = save_data.self_prompt;
                // add initial message to history
                this.history.add('system', prompt);
                this.self_prompter.start(prompt);
            }
            else if (init_message) {
                this.handleMessage('system', init_message, 2);
            }
            else {
                this.bot.chat('Hello world! I am ' + this.name);
                this.bot.emit('finished_executing');
            }

            this.startEvents();
            this.startContinueTimer();
        });
    }

    cleanChat(message) {
        // newlines are interpreted as separate chats, which triggers spam filters. replace them with spaces
        message = message.replaceAll('\n', '  ');
        return this.bot.chat(message);
    }

    shutUp() {
        this.shut_up = true;
        if (this.self_prompter.on) {
            this.self_prompter.stop(false);
        }
    }

    async ExtractCommandLLM(message) {
        // if (this.script_mode) {
        //     // In script mode, don't use LLM, just return an empty array //actually, we do want to execute commands in script mode
        //     return [];
        // }

        const prompt = `
        You are tasked with extracting valid Minecraft commands from a given message. Here are your instructions:

1. You will be provided with a message enclosed in <message> tags. This message may contain text and potential Minecraft commands.

<message>
${message}
</message>

2. A valid Minecraft command must start with a forward slash ('/') character.

3. Your task is to identify and extract only the valid Minecraft commands from the message.

4. Follow these steps:
   a. Read through the entire message.
   b. Identify any text strings that begin with a '/' character.
   c. Extract these strings as potential Minecraft commands.
   d. Do not include any text before or after the command in your extraction.

5. Format your output as a JSON array of strings. Each valid command should be a separate string within the array.

6. If you find no valid commands in the message, return an empty JSON array.

7. Provide your answer within <answer> tags.

Here's an example of how your output should look if valid commands are found:
<answer>
["command1", "/command2", "/command3"]
</answer>

And if no valid commands are found:
<answer>
[]
</answer>

Remember, only include commands that start with a '/' character, and ensure your output is a valid JSON array.
        `;

        try {
            const response = await this.client.messages.create({
                model: "claude-3-5-sonnet-20240620",
                max_tokens: 1000,
                temperature: 0,
                messages: [{ role: "user", content: prompt }],
            });

            const content = response.content[0].text;
            const startIndex = content.indexOf('<answer>') + 8;
            const endIndex = content.indexOf('</answer>');
            
            if (startIndex !== -1 && endIndex !== -1) {
                const jsonString = content.substring(startIndex, endIndex).trim();
                const commandList = JSON.parse(jsonString);
                
                if (Array.isArray(commandList)) {
                    for (const command of commandList) {
                        if (typeof command === 'string' && command.startsWith('/')) {
                            const isSafe = await this.evaluateCommand(command);
                            if (isSafe) {
                                await this.bot.chat(command);
                                console.log("Executed command:", command);
                            } else {
                                console.log("Command deemed unsafe and not executed:", command);
                            }
                        }
                    }
                } else {
                    console.warn('Invalid response format from LLM:', jsonString);
                }
            } else {
                console.warn('Could not find answer tags in LLM response');
            }
        } catch (error) {
            console.error('Error in ExtractCommandLLM:', error);
        }
    }

    async handleMessage(source, message, max_responses=null) {
        let used_command = false;
        if (max_responses === null) {
            max_responses = settings.max_commands === -1 ? Infinity : settings.max_commands;
        }

        let self_prompt = source === 'system' || source === this.name;

        if (!self_prompt) {
            const user_command_name = containsCommand(message);
            if (user_command_name) {
                if (!commandExists(user_command_name)) {
                    this.bot.chat(`Command '${user_command_name}' does not exist.`);
                    return false;
                }
                this.bot.chat(`*${source} used ${user_command_name.substring(1)}*`);
                if (user_command_name === '!newAction') {
                    // all user initiated commands are ignored by the bot except for this one
                    // add the preceding message to the history to give context for newAction
                    this.history.add(source, message);
                }
                const isSafe = await this.evaluateCommand(message);
                if (!isSafe) {
                    this.bot.chat(`Command '${user_command_name}' was deemed unsafe and will not be executed.`);
                    return false;
                }
                let execute_res = await executeCommand(this, message);
                if (execute_res) 
                    this.cleanChat(execute_res);
                return true;
            }
        }

        const checkInterrupt = () => this.self_prompter.shouldInterrupt(self_prompt) || this.shut_up;

        await this.history.add(source, message);
        this.history.save();

        if (!self_prompt && this.self_prompter.on) // message is from user during self-prompting
            max_responses = 1; // force only respond to this message, then let self-prompting take over
        for (let i=0; i<max_responses; i++) {
            if (checkInterrupt()) break;
            let history = this.history.getHistory();
            let res;
            if (this.script_mode) {
                res = this.script_answers[this.current_script_answer];
                this.current_script_answer = (this.current_script_answer + 1) % this.script_answers.length;
            } else {
                res = await this.prompter.promptConvo(history);
            }

            let command_name = containsCommand(res);

            if (command_name) { // contains query or command
                console.log(`Full response: ""${res}""`)
                res = truncCommandMessage(res); // everything after the command is ignored
                this.history.add(this.name, res);
                if (!commandExists(command_name)) {
                    this.history.add('system', `Command ${command_name} does not exist.`);
                    console.warn('Agent hallucinated command:', command_name)
                    continue;
                }
                if (command_name === '!stopSelfPrompt' && self_prompt) {
                    this.history.add('system', `Cannot stopSelfPrompt unless requested by user.`);
                    continue;
                }

                if (checkInterrupt()) break;
                this.self_prompter.handleUserPromptedCmd(self_prompt, isAction(command_name));

                const isSafe = await this.evaluateCommand(res);
                if (!isSafe) {
                    this.history.add('system', `Command ${command_name} was deemed unsafe and will not be executed.`);
                    continue;
                }

                if (settings.verbose_commands) {
                    this.cleanChat(res);
                }
                else { // only output command name
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    let chat_message = `*used ${command_name.substring(1)}*`;
                    if (pre_message.length > 0)
                        chat_message = `${pre_message}  ${chat_message}`;
                    this.cleanChat(res);
                }

                let execute_res = await executeCommand(this, res);

                console.log('Agent executed:', command_name, 'and got:', execute_res);
                used_command = true;

                if (execute_res)
                    this.history.add('system', execute_res);
                else
                    break;
            }
            else { // conversation response
                this.history.add(this.name, res);
                console.log('Purely conversational response:', res);
                
                // Use the new ExtractCommandLLM function for conversation responses
                await this.ExtractCommandLLM(res);
                
                break;
            }
            this.history.save();
        }

        this.bot.emit('finished_executing');
        return used_command;
    }

    startEvents() {
        // Custom events
        this.bot.on('time', () => {
            if (this.bot.time.timeOfDay == 0)
            this.bot.emit('sunrise');
            else if (this.bot.time.timeOfDay == 6000)
            this.bot.emit('noon');
            else if (this.bot.time.timeOfDay == 12000)
            this.bot.emit('sunset');
            else if (this.bot.time.timeOfDay == 18000)
            this.bot.emit('midnight');
        });

        let prev_health = this.bot.health;
        this.bot.lastDamageTime = 0;
        this.bot.lastDamageTaken = 0;
        this.bot.on('health', () => {
            if (this.bot.health < prev_health) {
                this.bot.lastDamageTime = Date.now();
                this.bot.lastDamageTaken = prev_health - this.bot.health;
            }
            prev_health = this.bot.health;
        });
        // Logging callbacks
        this.bot.on('error' , (err) => {
            this.log('Error event!', err);
        });
        this.bot.on('end', (reason) => {
            this.log('Bot disconnected! Killing agent process.', reason)
            this.cleanKill('Bot disconnected! Killing agent process.');
        });
        this.bot.on('death', () => {
            this.coder.cancelResume();
            this.coder.stop();
        });
        this.bot.on('kicked', (reason) => {
            this.log('Bot kicked!', reason);
            this.cleanKill('Bot kicked! Killing agent process.');
        });
        this.bot.on('messagestr', async (message, _, jsonMsg) => {
            if (jsonMsg.translate && jsonMsg.translate.startsWith('death') && message.startsWith(this.name)) {
                console.log('Agent died: ', message);
                this.handleMessage('system', `You died with the final message: '${message}'. Previous actions were stopped and you have respawned. Notify the user and perform any necessary actions.`);
            }
        });
        this.bot.on('idle', () => {
            this.bot.clearControlStates();
            this.bot.pathfinder.stop(); // clear any lingering pathfinder
            this.bot.modes.unPauseAll();
            this.coder.executeResume();
        });

        // Init NPC controller
        this.npc.init();

        // This update loop ensures that each update() is called one at a time, even if it takes longer than the interval
        const INTERVAL = 300;
        let last = Date.now();
        setTimeout(async () => {
            while (true) {
                let start = Date.now();
                await this.update(start - last);
                let remaining = INTERVAL - (Date.now() - start);
                if (remaining > 0) {
                    await new Promise((resolve) => setTimeout(resolve, remaining));
                }
                last = start;
            }
        }, INTERVAL);

        this.bot.emit('idle');
    }

    async update(delta) {
        await this.bot.modes.update();
        await this.self_prompter.update(delta);
    }

    isIdle() {
        return !this.coder.executing && !this.coder.generating;
    }
    
    cleanKill(msg='Killing agent process...') {
        this.history.add('system', msg);
        this.bot.chat('Goodbye world.')
        this.history.save();
        process.exit(1);
    }

    startContinueTimer() {
        if (this.continueInterval) {
            clearInterval(this.continueInterval);
        }
        this.continueInterval = setInterval(() => {
            if (this.continue_bool) {
                this.handleContinueCommand();
            }
        }, this.continue_timer * 1000);
    }

    stopContinueTimer() {
        if (this.continueInterval) {
            clearInterval(this.continueInterval);
            this.continueInterval = null;
        }
    }

    handleContinueCommand() {
        if (this.isIdle()) {
            this.handleMessage('system', 'Continue maximizing diamonds.');
        }
    }

    setContinueMode(enabled, timer = null) {
        this.continue_bool = enabled;
        if (timer !== null) {
            this.continue_timer = timer;
            this.stopContinueTimer();
            this.startContinueTimer();
        }
        return `Continue mode ${enabled ? 'enabled' : 'disabled'}${timer !== null ? ` with timer set to ${timer} seconds` : ''}.`;
    }

    createSafetyAgent() {
        return new Anthropic({
            apiKey: keys.ANTHROPIC_API_KEY,
        });
    }

    async evaluateCommand(command) {
        this.log('Evaluating command:', command);
        const prompt = `
        You are a safety agent responsible for evaluating Minecraft commands before they are executed. Your task is to determine if the command is safe to execute. IMPORTANT: All commands must only affect the world in the specified {-50, -64, -50} and {50, 256, 50} coordinate area.

        Command to evaluate:
        ${command}

        Respond with either "SAFE" or "UNSAFE" followed by a brief explanation.

        Example responses:
        SAFE: This command simply makes the bot move to a new location.
        UNSAFE: This command attempts to summon millions of diamonds every tick and will crash the game.
        SAFE: This command simply fills a 10x10x10 area with diamond blocks inside the specified -50, -64, -50, and 50 256, 50 area.
        UNSAFE: This command attempts to affect blocks outside the specified -50, -64, -50, and 50 256, 50 area.

        Your evaluation:
        `;

        try {
            const response = await this.safetyAgent.messages.create({
                model: "claude-3-5-sonnet-20240620",
                max_tokens: 150,
                temperature: 0,
                messages: [{ role: "user", content: prompt }],
            });

            const evaluation = response.content[0].text.trim();
            this.log('Safety evaluation result:', evaluation);
            return evaluation.startsWith("SAFE");
        } catch (error) {
            console.error('Error in command evaluation:', error);
            return false; // Assume unsafe if there's an error
        }
    }
}