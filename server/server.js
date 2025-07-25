const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { exec } = require('child_process'); // Node.js module for executing shell commands
const fs = require('fs/promises'); // For file system operations (async)
const path = require('path'); // For path manipulation

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let codeContent = {
    javascript: '// Write your JavaScript code here...',
    python: '# Write your Python code here...\nprint("Hello from Python!")',
    cpp: '// Write your C++ code here...\n#include <iostream>\nint main() {\n    std::cout << "Hello from C++!";\n    return 0;\n}',
    c: '// Write your C code here...\n#include <stdio.h>\nint main() {\n    printf("Hello from C!");\n    return 0;\n}',
    // Java removed from here
};
let outputContent = '';
let currentLanguage = 'javascript'; // Default language

// --- Function to execute code directly (UNSAFE FOR PRODUCTION) ---
async function executeCodeDirectly(lang, code) {
    let output = '';
    const tempDir = path.join(__dirname, 'temp_code_executions'); // Create a temp directory
    await fs.mkdir(tempDir, { recursive: true });

    try {
        const uniqueId = Date.now() + '-' + Math.random().toString(36).substring(2, 8); // Simple unique ID
        let filename;
        let compileCommand = '';
        let executeCommand = '';

        switch (lang) {
            case 'javascript':
                filename = `script-${uniqueId}.js`;
                await fs.writeFile(path.join(tempDir, filename), code);
                executeCommand = `node ${path.join(tempDir, filename)}`;
                break;
            case 'python':
    filename = `script-${uniqueId}.py`;
    const pythonFilePath = path.join(tempDir, filename); // Store the full path
    await fs.writeFile(pythonFilePath, code);
    executeCommand = `python "${pythonFilePath}"`; // <--- ENSURE THESE DOUBLE QUOTES ARE HERE
    break;

           case 'cpp':
    filename = `main-${uniqueId}.cpp`;
    const compiledExecNameCpp = `a.out-${uniqueId}.exe`; // .exe for Windows
    const cppFilePath = path.join(tempDir, filename);
    const compiledCppPath = path.join(tempDir, compiledExecNameCpp);
    await fs.writeFile(cppFilePath, code);
    compileCommand = `g++ "${cppFilePath}" -o "${compiledCppPath}"`; // Ensure quotes
    executeCommand = `"${compiledCppPath}"`; // Ensure quotes
    break;
case 'c':
    filename = `main-${uniqueId}.c`;
    const compiledExecNameC = `a.out-${uniqueId}.exe`; // .exe for Windows
    const cFilePath = path.join(tempDir, filename);
    const compiledCPath = path.join(tempDir, compiledExecNameC);
    await fs.writeFile(cFilePath, code);
    compileCommand = `gcc "${cFilePath}" -o "${compiledCPath}"`; // Ensure quotes
    executeCommand = `"${compiledCPath}"`; // Ensure quotes
    break;
            // Java case removed
            default:
                throw new Error('Unsupported language for direct execution.');
        }

        // --- Compilation Step (for compiled languages) ---
        if (compileCommand) {
            console.log(`Compiling: ${compileCommand}`);
            const { stdout: compileStdout, stderr: compileStderr } = await new Promise((resolve, reject) => {
                exec(compileCommand, { cwd: tempDir, timeout: 5000 }, (error, stdout, stderr) => { // 5s compile timeout
                    if (error) {
                        reject(new Error(`Compilation failed: ${stderr || stdout || error.message}`));
                    } else {
                        resolve({ stdout, stderr });
                    }
                });
            });
            if (compileStderr) {
                console.warn('Compile warnings:', compileStderr);
                // You might choose to include warnings in the output or just log them
            }
        }

        // --- Execution Step ---
        console.log(`Executing: ${executeCommand}`);
        const { stdout, stderr } = await new Promise((resolve, reject) => {
            exec(executeCommand, { cwd: tempDir, timeout: 10000 }, (error, stdout, stderr) => { // 10s execution timeout
                if (error) {
                    reject(new Error(`Execution failed: ${stderr || stdout || error.message}`));
                } else {
                    resolve({ stdout, stderr });
                }
            });
        });

        output = stdout || stderr || 'Execution completed with no output.';

    } catch (error) {
        output = `Error: ${error.message}`;
        console.error(`Direct execution error for ${lang}:`, error);
    } finally {
        // --- Cleanup temporary files ---
        try {
            const files = await fs.readdir(tempDir);
            for (const file of files) {
                if (file.includes(uniqueId)) { // No need to check for .class files anymore
                     await fs.unlink(path.join(tempDir, file));
                }
            }
        } catch (cleanupError) {
            console.error('Error cleaning up temp files:', cleanupError);
        }
    }
    return output;
}

wss.on('connection', ws => {
    console.log('Client connected');

    // Send initial code, output, and current language to the new client
    ws.send(JSON.stringify({ type: 'initialState', code: codeContent[currentLanguage], output: outputContent, language: currentLanguage }));

    ws.on('message', async message => {
        const parsedMessage = JSON.parse(message);

        if (parsedMessage.type === 'codeChange') {
            const { lang, code } = parsedMessage;
            if (codeContent.hasOwnProperty(lang)) {
                codeContent[lang] = code;
            }
            // Broadcast code changes to all other connected clients for the specific language
            wss.clients.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'codeUpdate', lang: lang, code: code }));
                }
            });
        } else if (parsedMessage.type === 'languageChange') {
            const { lang } = parsedMessage;
            if (codeContent.hasOwnProperty(lang)) {
                currentLanguage = lang;
                // Send the code for the new language to all clients
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'languageUpdate', lang: currentLanguage, code: codeContent[currentLanguage] }));
                    }
                });
            }
        } else if (parsedMessage.type === 'runCode') {
            const { lang, code } = parsedMessage;
            console.log(`Running ${lang} code directly...`);
            let executionOutput = '';

            // Notify all clients that code is running
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'outputUpdate', output: 'Executing locally...' }));
                }
            });

            try {
                executionOutput = await executeCodeDirectly(lang, code);
            } catch (error) {
                executionOutput = `Internal Server Error: ${error.message}`;
                console.error('Unhandled error in runCode:', error);
            }

            outputContent = executionOutput; // Update server's stored output

            // Broadcast output to all connected clients
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'outputUpdate', output: outputContent }));
                }
            });
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', error => {
        console.error('WebSocket error:', error);
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

app.get('/', (req, res) => {
    res.send('WebSocket server is running. Connect via client application.');
});