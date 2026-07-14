const express = require('express');
const multer = require('multer');
const cors = require('cors');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { GoogleGenAI } = require('@google/genai');
const { Document, Packer, Paragraph, TextRun } = require('docx');

const app = express();
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } 
});

// Middleware
app.use(cors()); // Critical for GitHub Pages to talk to Render
app.use(express.json({ limit: '10mb' }));

// 1. ENDPOINT: Process documents & Extract Name
app.post('/api/ingest-profile', upload.array('resumes', 5), async (req, res) => {
    try {
        const apiKey = req.headers['x-gemini-key'];
        if (!apiKey) return res.status(400).json({ error: 'Gemini API Key missing.' });

        let combinedText = '';
        if (req.files) {
            for (const file of req.files) {
                if (file.mimetype === 'application/pdf') {
                    const data = await pdfParse(file.buffer);
                    combinedText += `\n${data.text}`;
                } else {
                    const data = await mammoth.extractRawText({ buffer: file.buffer });
                    combinedText += `\n${data.value}`;
                }
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

        const prompt = `Candidate: ${userName}. Analyze suitability for this job. Provide match % and strengths/gaps.
        BACKGROUND: ${profileText}
        JOB: ${jobDescription}`;

        const result = await model.generateContent(prompt);
        res.json({ analysis: result.response.text() });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 3. ENDPOINT: Resume Tailoring
app.post('/api/tailor-resume', async (req, res) => {
    try {
        const { profileText, userName, jobDescription } = req.body;
        const ai = new GoogleGenAI(req.headers['x-gemini-key']);
        const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `Rewrite a professional resume for ${userName} for this job. 
        STRICT: Use PLAIN TEXT ONLY. No markdown (*, #). 
        JOB: ${jobDescription}
        PROFILE: ${profileText}`;

        const result = await model.generateContent(prompt);
        res.json({ tailoredText: result.response.text() });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 4. ENDPOINT: DOCX Generation
app.post('/api/download-docx', async (req, res) => {
    try {
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
    } catch (error) { res.status(500).send("DOCX error"); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend live on port ${PORT}`));
