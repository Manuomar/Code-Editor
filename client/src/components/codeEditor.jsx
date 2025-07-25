import React, { useRef, useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';

const CodeEditor = () => {
  const editorRef = useRef(null);
  const webSocketRef = useRef(null);
  // Using an object to store code for each language
  const [code, setCode] = useState({
    javascript: '// Write your JavaScript code here...',
    python: '# Write your Python code here...\nprint("Hello from Python!")',
    cpp: '// Write your C++ code here...\n#include <iostream>\nint main() {\n    std::cout << "Hello from C++!";\n    return 0;\n}',
    c: '// Write your C code here...\n#include <stdio.h>\nint main() {\n    printf("Hello from C!");\n    return 0;\n}',
    // Java removed from here
  });
  const [output, setOutput] = useState('');
  const [currentLanguage, setCurrentLanguage] = useState('javascript'); // Tracks active language
  const [isConnecting, setIsConnecting] = useState(true);

  // Helper to map language names for Monaco Editor
  const monacoLanguageMap = {
    javascript: 'javascript',
    python: 'python',
    cpp: 'cpp', // Monaco's id for C++
    c: 'c',     // Monaco's id for C
    // Java removed from here
  };

  useEffect(() => {
    // Connect to WebSocket
    webSocketRef.current = new WebSocket('ws://localhost:8080');

    webSocketRef.current.onopen = () => {
      console.log('WebSocket connected');
      setIsConnecting(false);
    };

    webSocketRef.current.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log('Received message:', message);

      if (message.type === 'initialState') {
        // Set initial state from server
        setCode(prevCode => ({ ...prevCode, [message.language]: message.code }));
        setCurrentLanguage(message.language);
        setOutput(message.output);
        if (editorRef.current) {
          editorRef.current.setValue(message.code);
          // Set language of editor
          editorRef.current.setModel(window.monaco.editor.createModel(message.code, monacoLanguageMap[message.language]));
        }
      } else if (message.type === 'codeUpdate') {
        const { lang, code: updatedCode } = message;
        setCode(prevCode => ({ ...prevCode, [lang]: updatedCode }));
        // Only update editor if the updated code is for the currently viewed language
        if (lang === currentLanguage && editorRef.current && editorRef.current.getValue() !== updatedCode) {
          editorRef.current.setValue(updatedCode);
        }
      } else if (message.type === 'outputUpdate') {
        setOutput(message.output);
      } else if (message.type === 'languageUpdate') {
        const { lang: newLang, code: newCode } = message;
        setCurrentLanguage(newLang);
        setCode(prevCode => ({ ...prevCode, [newLang]: newCode })); // Ensure local state is updated
        if (editorRef.current) {
          editorRef.current.setModel(window.monaco.editor.createModel(newCode, monacoLanguageMap[newLang]));
        }
      }
    };

    webSocketRef.current.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnecting(true);
      // Reconnection logic (consider exponential backoff in production)
      setTimeout(() => {
        console.log('Attempting to reconnect...');
        // window.location.reload(); // Simple reload for demonstration, consider more robust reconnect
      }, 3000);
    };

    webSocketRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnecting(true);
    };

    return () => {
      if (webSocketRef.current) {
        webSocketRef.current.close();
      }
    };
  }, [currentLanguage]); // Add currentLanguage to dependencies to re-mount editor on language change

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    // Store monaco instance globally if needed for model creation
    window.monaco = monaco;
  };

  const handleEditorChange = useCallback((value, event) => {
    // Update local state for the current language
    setCode(prevCode => ({ ...prevCode, [currentLanguage]: value }));
    // Send code changes to the server
    if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
      webSocketRef.current.send(JSON.stringify({ type: 'codeChange', lang: currentLanguage, code: value }));
    }
  }, [currentLanguage]); // Recreate if currentLanguage changes

  const handleLanguageChange = (e) => {
    const newLang = e.target.value;
    setCurrentLanguage(newLang); // Update local state immediately
    // Send language change to server
    if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
      webSocketRef.current.send(JSON.stringify({ type: 'languageChange', lang: newLang }));
    }
    // Update Monaco Editor's model with the code for the new language
    if (editorRef.current) {
      editorRef.current.setModel(window.monaco.editor.createModel(code[newLang], monacoLanguageMap[newLang]));
    }
  };


  const runCode = () => {
    if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
      setOutput('Running...'); // Clear previous output and show running state
      webSocketRef.current.send(JSON.stringify({ type: 'runCode', lang: currentLanguage, code: code[currentLanguage] }));
    } else {
      setOutput('Error: Not connected to server.');
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 p-4 flex justify-between items-center shadow-md">
        <h1 className="text-2xl font-bold text-blue-400">Collaborative Code Editor</h1>
        <div className="flex items-center space-x-4">
          <select
            className="p-2 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={currentLanguage}
            onChange={handleLanguageChange}
          >
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
            <option value="cpp">C++</option>
            <option value="c">C</option>
            {/* Java option removed */}
          </select>
          <button
            onClick={runCode}
            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition duration-200 ease-in-out transform hover:scale-105"
            disabled={isConnecting}
          >
            Run Code
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 p-4">
          <h2 className="text-xl font-semibold mb-2 text-gray-300">Code Editor ({currentLanguage.toUpperCase()})</h2>
          <div className="border border-gray-700 rounded-lg overflow-hidden h-[calc(100vh-200px)]"> {/* Adjust height as needed */}
            <Editor
              height="100%"
              language={monacoLanguageMap[currentLanguage]} // Use mapped language for Monaco
              theme="vs-dark"
              value={code[currentLanguage]} // Display code for current language
              onMount={handleEditorDidMount}
              onChange={handleEditorChange}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                wordWrap: 'on',
                scrollBeyondLastLine: false,
              }}
            />
          </div>
        </div>

        <div className="w-1/3 p-4 border-l border-gray-700 flex flex-col">
          <h2 className="text-xl font-semibold mb-2 text-gray-300">Output</h2>
          <div className="flex-1 bg-gray-800 p-4 rounded-lg font-mono text-sm overflow-auto break-words whitespace-pre-wrap border border-gray-700">
            {isConnecting ? (
              <p className="text-yellow-500">Connecting to server...</p>
            ) : (
              output || <p className="text-gray-500">Run code to see output...</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CodeEditor;