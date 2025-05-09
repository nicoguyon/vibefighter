import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';

// Ensure environment variables are set
if (!process.env.REPLICATE_API_TOKEN) {
  throw new Error('Missing REPLICATE_API_TOKEN environment variable.');
}
if (!process.env.LORA_LINK) {
  throw new Error('Missing LORA_LINK environment variable.');
}
if (!process.env.LORA_TOKEN) {
  // It's a style token, so we can default it or warn. Let's warn for now.
  console.warn('Missing LORA_TOKEN environment variable. Defaulting to empty string for style.');
}


const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const loraWeights = process.env.LORA_LINK;
const loraStyleToken = process.env.LORA_TOKEN; // Keep as potentially undefined
let loraScale = 1; // Default LORA_SCALE
if (process.env.LORA_SCALE) {
    const parsedScale = parseFloat(process.env.LORA_SCALE);
    if (!isNaN(parsedScale)) {
        loraScale = parsedScale;
    }
}

// Define the expected input structure
interface RequestBody {
    userPrompt: string;
}

// Define the expected output structure (FileOutput has a url() method)
interface ReplicateFileOutput {
    url: () => string; // It's a method returning a string
    // Potentially other methods like blob(), etc.
}

export async function POST(req: NextRequest) {
    let requestBody: RequestBody;

    try {
        requestBody = await req.json();
    } catch (error) {
        console.error("Failed to parse request body:", error);
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { userPrompt } = requestBody;

    if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.trim().length === 0) {
        return NextResponse.json({ error: 'Missing or invalid userPrompt' }, { status: 400 });
    }

    // Construct the full prompt
    let fullPrompt = `Full body front facing arms along the body humanoid like detailed 3D render of ${userPrompt}`;
    if (loraStyleToken && loraStyleToken.trim() !== "") {
        fullPrompt += `, ${loraStyleToken.trim()}`;
    }
    fullPrompt += `, on a neutral black background`;

    // Prepare input for Replicate API
    const input: any = {
        prompt: fullPrompt,
        go_fast: false,
        guidance: 3,
        megapixels: "1", // Keeping settings from example
        num_outputs: 2,
        aspect_ratio: "9:16", // Vertical aspect ratio, good for characters
        output_format: "jpg", // Using jpg as requested
        output_quality: 80,
        prompt_strength: 0.8,
        num_inference_steps: 28
    };

    if (loraWeights && loraWeights.trim() !== "") {
        input.lora_weights = loraWeights.trim();
        input.lora_scale = loraScale; // Use the parsed or default LORA_SCALE
    }

    console.log("Running Replicate with input:", input);

    try {
        // Run the Replicate model - Type is initially unknown
        const output: unknown = await replicate.run(
            "black-forest-labs/flux-dev-lora",
            { input }
        );

        console.log("Raw Replicate output:", output);

        if (!Array.isArray(output)) {
             console.error("Replicate output is not an array:", output);
             throw new Error("Unexpected output format from image generation API (expected array).");
        }

        // Extract the URLs by CALLING the .url() method and accessing .href
        const imageUrls = output
            .map((item: unknown) => {
                 // Type check: ensure item is an object and has a url METHOD
                 if (typeof item === 'object' && item !== null && typeof (item as ReplicateFileOutput).url === 'function') {
                     try {
                         // Call the url() method - Expecting an object with an href property
                         const urlResult = (item as ReplicateFileOutput).url(); 
                         
                         // Check if the result has an href property that's a string
                         if (typeof urlResult === 'object' && urlResult !== null && typeof (urlResult as any).href === 'string') {
                              return (urlResult as any).href; // <-- Get the string URL here
                         } else {
                             console.warn("Item .url() method did not return an object with a string .href property:", urlResult);
                             return null;
                         }
                     } catch (e) {
                         console.error("Error calling .url() on item:", item, e);
                         return null;
                     }
                 } else {
                     console.warn("Ignoring invalid item (no url method) in Replicate output array:", item);
                     return null; // Return null for invalid items
                 }
            })
            .filter((url): url is string => url !== null); // Filter out the nulls

        // Check if we successfully got URLs
        if (imageUrls.length === 0) {
             console.error("Failed to extract valid URLs from Replicate FileOutput objects:", output);
             throw new Error("Failed to get valid image URLs from generation API output.");
        }

        console.log("Extracted Image URLs:", imageUrls);

        // Return the array of image URLs
        return NextResponse.json({ imageUrls: imageUrls }, { status: 200 });

    } catch (error: any) {
        console.error('Error calling Replicate API or processing output:', error);
        const errorMessage = error.response?.data?.detail || error.message || 'Failed to generate images';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
} 