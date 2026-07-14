const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const cors = require('cors');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// 1. CRITICAL: Allow your GitHub Pages URL
app.use(cors({
    origin: ["https://mpshere-ctrl.github.io", "http://localhost:3000"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "x-gemini-key"]
}));

app.use(express.json({ limit: '50mb' }));

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

// ROUTE 1: Ingest (Returns full text to frontend)
app.post('/api/ingest-profile', upload.array('resumes', 5), async (req, res) => {
    try {
        let combinedText = req.body.linkedinText || "";
        for (const file of req.files) {
            combinedText += "\n" + await extractText(file);
        }

        const genAI = new GoogleGenerativeAI(req.headers['x-gemini-key']);
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
        
        const result = await model.generateContent(`Extract the full name from this text: ${combinedText.substring(0, 1000)}`);
        const name = result.response.text().trim();

        res.json({ extractedName: name, fullText: combinedText });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// ROUTE 2: Tailor (Receives full context every time)
app.post('/api/tailor-resume', async (req, res) => {
    try {
        const { userName, profileText, jobDescription } = req.body;
        const genAI = new GoogleGenerativeAI(req.headers['x-gemini-key']);
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

        const prompt = `Rewrite a professional resume for ${userName}. 
        Context: ${profileText}
        Target Job: ${jobDescription}
        CONSTRAINT: Output ONLY plain text. No markdown symbols like * or #.`;

        const result = await model.generateContent(prompt);
        res.json({ tailoredText: result.response.text() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ROUTE 3: Download
app.post('/api/download-docx', async (req, res) => {
    const doc = new Document({
        sections: [{
            children: req.body.resumeText.split('\n').map(line => new Paragraph({ children: [new TextRun(line)] }))
        }]
    });
    const b64 = await Packer.toBase64String(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(Buffer.from(b64, 'base64'));
});

app.listen(process.env.PORT || 3000);
