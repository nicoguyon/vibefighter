import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Helper function to read directory and return relative file paths
const getMusicFiles = (directory: string, prefix: string): string[] => {
    const absoluteDirectoryPath = path.join(process.cwd(), 'public', directory);
    try {
        const files = fs.readdirSync(absoluteDirectoryPath);
        return files
            .filter(file => /\.(mp3|wav|ogg|m4a)$/i.test(file)) // Filter for common audio formats
            .map(file => `${prefix}/${file}`); // Prepend the public path prefix
    } catch (error: any) {
         // Log specific errors if needed, e.g., directory not found
        if (error.code === 'ENOENT') {
             console.warn(`[API/music-files] Directory not found: ${absoluteDirectoryPath}`);
        } else {
             console.error(`[API/music-files] Error reading directory ${absoluteDirectoryPath}:`, error);
        }
        return []; // Return empty array on error
    }
};

export async function GET() {
    try {
        const screenFiles = getMusicFiles('music/screens', '/music/screens');
        const fightFiles = getMusicFiles('music/fights', '/music/fights');

        if (screenFiles.length === 0 && fightFiles.length === 0) {
             console.warn("[API/music-files] No music files found in either directory.");
             // Decide if this is an error or just an empty state
        }

        return NextResponse.json({
            default: screenFiles,
            fight: fightFiles,
        });
    } catch (error) {
        console.error('[API/music-files] Unexpected error in GET handler:', error);
        return NextResponse.json({ error: 'Failed to fetch music files' }, { status: 500 });
    }
}

// Optional: Prevent caching if files might change frequently without rebuilds
export const dynamic = 'force-dynamic'; 