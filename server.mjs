import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

import express from 'express';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// 1. ENDPOINT: Process uploads and extract text/name
app.post('/api/ingest-profile', upload.array('resumes', 5), async (req, res) => {
    try {
        const apiKey = req.headers['x-gemini-key'];
        if (!apiKey) return res.status(400).json({ error: 'API Key missing.' });

        let combinedText = '';
        for (const file of req.files) {
            if (file.mimetype === 'application/pdf') {
                const data = await pdfParse(file.buffer);
                combinedText += `\n${data.text}`;
            } else {
                const data = await mammoth.extractRawText({ buffer: file.buffer });
                combinedText += `\n${data.value}`;
            }
        }
        combinedText += `\n${req.body.linkedinText || ''}`;

        const ai = new GoogleGenAI(apiKey);
        const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
        
        const nameResult = await model.generateContent(`Extract ONLY the full name from this text. If not found, say "Candidate". Text: ${combinedText.slice(0, 2000)}`);
        const extractedName = nameResult.response.text().trim();

        res.json({ extractedName, fullText: combinedText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. ENDPOINT: Suitability Analysis
app.post('/api/analyze-suitability', async (req, res) => {
    try {
        const { profileText, userName, jobDescription } = req.body;
        const ai = new GoogleGenAI(req.headers['x-gemini-key']);
        const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `User: ${userName}. Analyze suitability for this job.
        Profile: ${profileText}
        Job: ${jobDescription}`;

        const result = await model.generateContent(prompt);
        res.json({ analysis: result.response.text() });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 3. ENDPOINT: Resume Tailoring (No Markdown)
app.post('/api/tailor-resume', async (req, res) => {
    try {
        const { profileText, userName, jobDescription } = req.body;
        const ai = new GoogleGenAI(req.headers['x-gemini-key']);
        const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `Rewrite a professional resume for ${userName}. 
        STRICT RULES: Use PLAIN TEXT ONLY. No asterisks, no bolding, no markdown. 
        Job: ${jobDescription}. Profile: ${profileText}`;

        const result = await model.generateContent(prompt);
        res.json({ tailoredText: result.response.text() });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 4. ENDPOINT: DOCX Generation
app.post('/api/download-docx', async (req, res) => {
    const { resumeText } = req.body;
    const doc = new Document({
        sections: [{
            children: resumeText.split('\n').map(line => 
                new Paragraph({ children: [new TextRun({ text: line, size: 22, font: "Arial" })] })
            ),
        }],
    });
    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(buffer);
});

app.listen(3000, () => console.log("🚀 Server running on http://localhost:3000"));