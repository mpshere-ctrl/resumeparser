const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const cors = require('cors');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// --- BULLETPROOF CORS CONFIG ---
app.use(cors({
    origin: ["https://mpshere-ctrl.github.io", "http://localhost:3000"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "x-gemini-key"]
}));

app.use(express.json({ limit: '50mb' }));

// In-Memory Session Cache
let userProfileSession = {
    userName: "Candidate",
    extractedProfileText: "",
    isLoaded: false
};

// --- HELPER: TEXT EXTRACTION ---
async function extractText(file) {
    if (file.mimetype === 'application/pdf') {
        const data = await pdf(file.buffer);
        return data.text;
    } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const data = await mammoth.extractRawText({ buffer: file.buffer });
        return data.value;
    }
    return "";
}

// --- ENDPOINTS ---

app.post('/api/ingest-profile', upload.array('resumes', 5), async (req, res) => {
    try {
        const apiKey = req.headers['x-gemini-key'];
        if (!apiKey) return res.status(400).json({ error: "Missing Gemini Key" });

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        let combinedText = req.body.linkedinText || "";
        if (req.files) {
            for (const file of req.files) {
                combinedText += "\n" + await extractText(file);
            }
        }

        // Auto-extract name
        const prompt = `Extract only the full name from this text. Return ONLY the name: ${combinedText.substring(0, 2000)}`;
        const result = await model.generateContent(prompt);
        const name = result.response.text().trim();

        userProfileSession = {
            userName: name || "Candidate",
            extractedProfileText: combinedText,
            isLoaded: true
        };

        res.json({ 
            extractedName: userProfileSession.userName, 
            fullText: userProfileSession.extractedProfileText 
        });
    } catch (error) {
        console.error("Ingest Error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/analyze-suitability', async (req, res) => {
    try {
        const { userName, profileText, jobDescription } = req.body;
        const genAI = new GoogleGenerativeAI(req.headers['x-gemini-key']);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `Analyze how well ${userName} fits this job. Profile: ${profileText} Job: ${jobDescription}`;
        const result = await model.generateContent(prompt);
        res.json({ analysis: result.response.text() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tailor-resume', async (req, res) => {
    try {
        const { userName, profileText, jobDescription } = req.body;
        const genAI = new GoogleGenerativeAI(req.headers['x-gemini-key']);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `Rewrite a resume for ${userName} based on: ${profileText}. Target Job: ${jobDescription}. 
        CONSTRAINT: Use plain text only. Do NOT use markdown (*, #, **).`;
        
        const result = await model.generateContent(prompt);
        res.json({ tailoredText: result.response.text() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/download-docx', async (req, res) => {
    const { resumeText } = req.body;
    const doc = new Document({
        sections: [{
            children: resumeText.split('\n').map(line => new Paragraph({
                children: [new TextRun(line)]
            }))
        }]
    });

    const b64string = await Packer.toBase64String(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(Buffer.from(b64string, 'base64'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server active on port ${PORT}`));
