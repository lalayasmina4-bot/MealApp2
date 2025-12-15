/**
 * Meal Prep Assistant - AI-Powered Version
 * All understanding, memory, and planning is delegated to AI
 * No manual NLP, parsing, or decision logic
 */

// Configuration
const CONFIG = {
    // OpenAI API configuration
    // NOTE: In production, use a backend proxy to protect your API key
    // For now, you can set this in localStorage or environment
    apiKey: localStorage.getItem('openai_api_key') || '',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o', // or 'gpt-3.5-turbo' for faster/cheaper responses
    
    // Fallback: If no API key, use mock responses for testing
    useMockAI: false
};

// State management - only conversation history, no manual parsing
const state = {
    isListening: false,
    recognition: null,
    conversationHistory: [], // Array of {role: 'user'|'assistant', content: string}
    isLoading: false
};

// DOM Elements
const micButton = document.getElementById('micButton');
const textInput = document.getElementById('textInput');
const sendButton = document.getElementById('sendButton');
const conversation = document.getElementById('conversation');
const welcomeMessage = document.getElementById('welcomeMessage');
const status = document.getElementById('status');

/**
 * System prompt for the AI assistant
 */
const SYSTEM_PROMPT = `You are a conversational meal prep assistant.

You are responsible for:
- Understanding natural language (including plurals, synonyms, and implicit meaning)
- Extracting and remembering user-provided information across turns
- Inferring reasonable defaults when information is missing
- Deciding when enough information is available
- Generating a complete weekly meal plan when ready

------------------------------------
MEMORY & STATE RULES
------------------------------------

All user messages are cumulative.
If the user provides information, you MUST remember it and NEVER ask for it again.

You must internally track:
- Household composition (adults, children, ages)
- Meals to plan (lunch, dinner, etc.)
- Duration (default to 7 days if "this week" is mentioned)
- Nutrition goals (default to balanced if unspecified)
- Allergies or intolerances (default to none if unspecified)
- Preferences and dislikes

------------------------------------
INFERENCE RULES
------------------------------------

You MUST correctly interpret:
- Singular and plural forms (e.g. lunch/lunches, dinner/dinners)
- "a kid" or "my kid" as one child
- "this week" as 7 days
- Silence about allergies as "no allergies"

Do NOT ask questions if a reasonable assumption can be made.

------------------------------------
DECISION RULE: ASK vs GENERATE
------------------------------------

If you have enough information to create a reasonable meal plan:
❌ STOP asking questions
✅ GENERATE a Version 1 weekly meal plan immediately

A first usable plan is ALWAYS better than waiting for perfect data.

------------------------------------
RESPONSE STRUCTURE
------------------------------------

When responding:

1️⃣ Briefly acknowledge what you understood  
2️⃣ If needed, ask ONLY truly missing questions  
3️⃣ If ready, generate a full weekly meal plan (lunch + dinner, Monday–Sunday)  
4️⃣ After the plan, optionally suggest refinements

------------------------------------
ANTI-FRUSTRATION RULE
------------------------------------

Assume the user does NOT want to repeat themselves.
Never re-ask answered questions.
Never ignore earlier information.

------------------------------------
GOAL
------------------------------------

Help the user get a concrete, family-friendly weekly meal prep plan as efficiently as possible.`;

/**
 * Initialize Speech Recognition
 */
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        console.warn('Speech Recognition not supported in this browser');
        micButton.style.display = 'none';
        return;
    }

    state.recognition = new SpeechRecognition();
    state.recognition.continuous = false;
    state.recognition.interimResults = false;
    state.recognition.lang = 'en-US';

    state.recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        textInput.value = transcript;
        updateStatus('Speech recognized! Click send or speak again.');
    };

    state.recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        updateStatus(`Error: ${event.error}. Please try again.`);
        stopListening();
    };

    state.recognition.onend = () => {
        stopListening();
    };
}

/**
 * Start listening for speech input
 */
function startListening() {
    if (!state.recognition) {
        updateStatus('Speech recognition not available in this browser.');
        return;
    }

    try {
        state.recognition.start();
        state.isListening = true;
        micButton.classList.add('listening');
        updateStatus('Listening... Speak now!');
    } catch (error) {
        console.error('Error starting recognition:', error);
        updateStatus('Could not start listening. Please try again.');
    }
}

/**
 * Stop listening for speech input
 */
function stopListening() {
    if (state.recognition && state.isListening) {
        try {
            state.recognition.stop();
        } catch (error) {
            // Ignore errors when stopping
        }
        state.isListening = false;
        micButton.classList.remove('listening');
    }
}

/**
 * Update status message
 */
function updateStatus(message) {
    status.textContent = message;
    if (message) {
        status.classList.add('active');
        if (!state.isListening && !state.isLoading) {
            setTimeout(() => {
                if (!state.isListening && !state.isLoading) {
                    status.textContent = '';
                    status.classList.remove('active');
                }
            }, 5000);
        }
    } else {
        status.classList.remove('active');
    }
}

/**
 * Add message to conversation
 */
function addMessage(text, isUser = false) {
    if (welcomeMessage.style.display !== 'none') {
        welcomeMessage.style.display = 'none';
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user' : 'assistant'}`;

    // Render user messages as plain text, assistant messages as Markdown
    if (isUser) {
        // User messages: unchanged, plain text
        messageDiv.textContent = text;
    } else {
        // Assistant messages: render as Markdown (headings, bullets, bold, etc.)
        // Do NOT escape Markdown characters or collapse line breaks.
        // Fallback to plain text if Markdown renderer is not available.
        if (window.marked && typeof window.marked.parse === 'function') {
            messageDiv.innerHTML = window.marked.parse(text);
        } else if (window.marked && typeof window.marked === 'function') {
            // Older versions export marked as a function
            messageDiv.innerHTML = window.marked(text);
        } else {
            messageDiv.textContent = text;
        }
    }

    conversation.appendChild(messageDiv);
    
    conversation.scrollTop = conversation.scrollHeight;
}

/**
 * Call AI API to get response
 */
async function callAI(userMessage) {
    // Add user message to history
    state.conversationHistory.push({
        role: 'user',
        content: userMessage
    });

    // Prepare messages for API
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...state.conversationHistory
    ];

    // Check if we should use mock AI
    if (CONFIG.useMockAI || !CONFIG.apiKey) {
        return getMockAIResponse(userMessage);
    }

    try {
        updateStatus('Thinking...');
        state.isLoading = true;

        const response = await fetch(CONFIG.apiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.apiKey}`
            },
            body: JSON.stringify({
                model: CONFIG.model,
                messages: messages,
                temperature: 0.7,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'API request failed');
        }

        const data = await response.json();
        const aiResponse = data.choices[0].message.content;

        // Add AI response to history
        state.conversationHistory.push({
            role: 'assistant',
            content: aiResponse
        });

        return aiResponse;

    } catch (error) {
        console.error('AI API error:', error);
        
        // Fallback to mock if API fails
        if (!CONFIG.useMockAI) {
            updateStatus('API error. Using fallback mode.');
            return getMockAIResponse(userMessage);
        }
        
        throw error;
    } finally {
        state.isLoading = false;
        updateStatus('');
    }
}

/**
 * Mock AI response for testing (when no API key is available)
 */
function getMockAIResponse(userMessage) {
    const lowerMessage = userMessage.toLowerCase();
    
    // Simple mock logic - just for demonstration
    // In production, this would be the real AI
    
    if (lowerMessage.includes('meal') || lowerMessage.includes('prep') || lowerMessage.includes('plan')) {
        if (lowerMessage.includes('kid') || lowerMessage.includes('child')) {
            return `Got it — you're planning meals for your family including a child.\n\nI just need a bit more information:\n• How many adults are in your household?\n• Which meals should I plan? (breakfast, lunch, dinner, snacks)\n• How many days should the meal prep cover?`;
        }
        return `Got it — I'm here to help with your meal prep planning.\n\nI just need a bit more information:\n• How many people are you cooking for? How many adults and how many children?\n• Which meals should I plan? (breakfast, lunch, dinner, snacks)\n• How many days should the meal prep cover?`;
    }
    
    return `I understand. Let me help you create a meal prep plan. Could you tell me more about your household and meal preferences?`;
}

/**
 * Handle form submission
 */
async function handleSubmit() {
    const userMessage = textInput.value.trim();
    
    if (!userMessage) {
        updateStatus('Please enter a message or use the microphone.');
        return;
    }

    if (state.isLoading) {
        return; // Prevent multiple submissions
    }

    // Add user message to conversation
    addMessage(userMessage, true);

    // Clear input
    textInput.value = '';
    updateStatus('');

    // Get AI response
    try {
        const aiResponse = await callAI(userMessage);
        addMessage(aiResponse, false);
    } catch (error) {
        updateStatus(`Error: ${error.message}. Please check your API configuration.`);
        addMessage('I apologize, but I encountered an error. Please try again or check your API configuration.', false);
    }
}

/**
 * Initialize event listeners
 */
function initEventListeners() {
    micButton.addEventListener('click', () => {
        if (state.isListening) {
            stopListening();
        } else {
            startListening();
        }
    });

    sendButton.addEventListener('click', handleSubmit);

    textInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    });

    textInput.addEventListener('focus', () => {
        if (state.isListening) {
            stopListening();
        }
    });
}

/**
 * Check API configuration on startup
 */
function checkConfiguration() {
    if (!CONFIG.apiKey && !CONFIG.useMockAI) {
        // Show configuration prompt
        const apiKey = prompt(
            'Enter your OpenAI API key (or leave empty to use mock mode):\n\n' +
            'Note: In production, use a backend proxy to protect your API key.\n' +
            'For now, you can enter it here (it will be stored in localStorage).'
        );
        
        if (apiKey && apiKey.trim()) {
            CONFIG.apiKey = apiKey.trim();
            localStorage.setItem('openai_api_key', CONFIG.apiKey);
            updateStatus('API key saved. Ready to use!');
        } else {
            CONFIG.useMockAI = true;
            updateStatus('Using mock mode. Set an API key for full functionality.');
        }
    } else if (CONFIG.apiKey) {
        updateStatus('Ready! Click the microphone or type your message.');
    } else {
        updateStatus('Using mock mode. Set an API key for full functionality.');
    }
}

/**
 * Initialize the application
 */
function init() {
    initSpeechRecognition();
    initEventListeners();
    checkConfiguration();
}

// Start the application when DOM is loaded
document.addEventListener('DOMContentLoaded', init);
