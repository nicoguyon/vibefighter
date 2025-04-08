import { NextRequest, NextResponse } from 'next/server';
import {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} from "@google/generative-ai";

// Basic fetch wrapper with timeout
async function fetchWithTimeout(resource: string | URL | Request, options: RequestInit & { timeout?: number } = {}) {
    const { timeout = 8000 } = options; // Default timeout 8s
    
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
  
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal  
    });
    clearTimeout(id);
  
    return response;
}

// Ensure API key is set
if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY environment variable.");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash", // Use flash for speed
    systemInstruction: "You are helping create a character for a retro 90s fighting platform video game. The user will provide an image of a character concept. Suggest 3 potential names. Respond ONLY with a valid JSON array of 3 strings, like [\"Name One\", \"Name Two\", \"Name Three\"]. Do not include any other text or markdown formatting.",
});

const generationConfig = {
    temperature: 0.8, // Slightly creative but not too random
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 1024, // Limit output size
    responseMimeType: "application/json", // Expect JSON directly
};

interface RequestBody {
    imageUrl: string;
}

export async function POST(req: NextRequest) {
    let requestBody: RequestBody;
    try {
        requestBody = await req.json();
    } catch (error) {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { imageUrl } = requestBody;
    if (!imageUrl || typeof imageUrl !== 'string') {
        return NextResponse.json({ error: 'Missing or invalid imageUrl' }, { status: 400 });
    }

    try {
        // Fetch the image data from the provided URL
        console.log(`Fetching image for Gemini: ${imageUrl}`);
        const imageResponse = await fetchWithTimeout(imageUrl, { timeout: 10000 }); // 10s timeout for image fetch
        if (!imageResponse.ok) {
            throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
        }
        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg'; // Default to jpeg if header missing
        const imageBuffer = await imageResponse.arrayBuffer();
        const imageBase64 = Buffer.from(imageBuffer).toString('base64');

        // Prepare the prompt parts for Gemini
        const promptParts = [
            { inlineData: { mimeType: contentType, data: imageBase64 } },
        ];

        console.log(`Sending image (${contentType}) to Gemini...`);
        const result = await model.generateContent({ 
            contents: [{ role: "user", parts: promptParts }],
            generationConfig 
        });

        const responseText = result.response.text(); 
        console.log("Raw Gemini response text:", responseText);
        
        // Attempt to parse the JSON response
        try {
            const names = JSON.parse(responseText);
            if (!Array.isArray(names) || names.length !== 3 || !names.every(n => typeof n === 'string')) {
                 throw new Error("Gemini response is not a valid JSON array of 3 strings.");
            }
            console.log("Suggested Names:", names);
            return NextResponse.json({ names }, { status: 200 });
        } catch (parseError) {
            console.error("Failed to parse Gemini response:", responseText, parseError);
            throw new Error("Received invalid name suggestions format.");
        }

    } catch (error: any) {
        console.error("Error suggesting names:", error);
        return NextResponse.json({ error: error.message || 'Failed to suggest names' }, { status: 500 });
    }
} 