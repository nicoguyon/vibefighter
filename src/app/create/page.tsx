"use client";

import { useState, ChangeEvent, useEffect, useRef, useCallback } from 'react';
import Image from "next/image"; // Keep if you plan to display images here
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid'; // Import uuid
import { supabase } from '@/lib/supabase/client'; // Import the client helper

// Interface for concept images (adjust as needed)
interface ConceptImage {
  id: number;
  url: string; // Or maybe base64 data
  alt: string;
}

// Define creation steps
type CreationStep = 'prompt' | 'selectConcept' | 'nameCharacter' | 'finalize'; // Added finalize back

// Interface for task status polling
interface TaskStatus {
    status: string;
    progress?: number;
    output?: any; // Define more specifically later if needed
}

export default function CreateCharacter() {
  const router = useRouter();

  // State
  const [creationStep, setCreationStep] = useState<CreationStep>('prompt');
  const [prompt, setPrompt] = useState<string>("");
  const [characterName, setCharacterName] = useState<string>("");
  const [suggestedNames, setSuggestedNames] = useState<string[]>([]); // State for names
  const [isSuggestingNames, setIsSuggestingNames] = useState<boolean>(false); // Loading state for names
  const [conceptImages, setConceptImages] = useState<ConceptImage[]>([]);
  const [selectedConceptIndex, setSelectedConceptIndex] = useState<number | null>(null);
  const [isGeneratingConcepts, setIsGeneratingConcepts] = useState<boolean>(false);
  const [backgroundTaskRunning, setBackgroundTaskRunning] = useState<boolean>(false); // Combined loading state
  const [error, setError] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState<string | null>(null); // Store the generated character ID
  const [modelTaskId, setModelTaskId] = useState<string | null>(null); // Store Tripo Task ID
  const [riggingTaskId, setRiggingTaskId] = useState<string | null>(null); // Store Rigging Task ID
  const [taskProgress, setTaskProgress] = useState<number>(0); // Progress state (0-100)
  const [taskStatus, setTaskStatus] = useState<string>(""); // Status message
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalImageUrl, setModalImageUrl] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null); // Ref for interval ID
  const [isModelComplete, setIsModelComplete] = useState<boolean>(false); // Track model task success
  const [isRigComplete, setIsRigComplete] = useState<boolean>(false); // Track rig task success
  const [isNameConfirmed, setIsNameConfirmed] = useState<boolean>(false); // Track if name has been confirmed by user click

  // Placeholder handlers for API calls (Moved from Home page)
  const handleGenerateConcepts = async () => {
    setError(null);
    setIsGeneratingConcepts(true);
    setConceptImages([]); // Clear previous images
    setSelectedConceptIndex(null);
    console.log("Calling API to generate concepts for:", prompt);

    try {
      const response = await fetch('/api/generate-concepts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userPrompt: prompt }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `API request failed with status ${response.status}`);
      }

      const data = await response.json();
      const imageUrls = data.imageUrls;

      if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
        throw new Error("Invalid image data received from API");
      }

      // Map URLs to ConceptImage structure
      const generatedImages: ConceptImage[] = imageUrls.map((url: string, index: number) => ({
          id: Date.now() + index,
          url: url,
          alt: `Generated Concept ${index + 1} for ${prompt}`
      }));

      setConceptImages(generatedImages);
      setCreationStep('selectConcept'); // Move to next step

    } catch (err: any) {
        console.error("Concept generation failed:", err);
        setError(err.message || "Failed to generate concepts. Please try again.");
        setCreationStep('prompt'); // Stay on prompt step if error
    } finally {
        setIsGeneratingConcepts(false);
    }
  };

  const handleReroll = async () => {
    // Reset selection and images before regenerating
    setSelectedConceptIndex(null);
    setConceptImages([]); 
    setCreationStep('prompt'); // Go back to prompt step to regenerate
    // We could also directly call handleGenerateConcepts here if we want to stay on step 2 visually
    // await handleGenerateConcepts(); 
  };

  // Function to proceed to the naming step
  const goToNameStep = () => {
    if (selectedConceptIndex !== null) {
        setError(null);
        setCreationStep('nameCharacter');
    } else {
        setError("Please select a concept first.");
    }
  };

  // Function to proceed to the final (model generation) step
  const goToFinalizeStep = () => {
    if (characterName.trim().length > 0) {
        setError(null);
        setCreationStep('finalize');
        handleFinalizeCharacter(); // Trigger the final action
    } else {
        setError("Please enter a name for your fighter.");
    }
  };
  
  // Placeholder for the actual model generation logic
  const handleFinalizeCharacter = async () => {
    if (selectedConceptIndex === null) {
        setError("Internal Error: No concept selected for finalization.");
        setCreationStep('selectConcept'); // Go back if state is inconsistent
        return;
    }
    setError(null);
    setIsGeneratingConcepts(true);
    console.log("Finalizing character:", characterName, "with concept:", conceptImages[selectedConceptIndex]?.url);
    try {
        // --- TODO: API Call --- 
        await new Promise(resolve => setTimeout(resolve, 2000));
        // --- TODO: Transition to next phase (e.g., show model/game) --- 
        alert(`Character '${characterName}' created! (Placeholder)`);
        // Example: Navigate to a success/view page or back to select
        // router.push('/character/view/' + characterName); 
        router.push('/select'); // Go back to select for now
    } catch (err: any) {
        console.error("3D model generation failed:", err);
        setError(err.message || "Failed to create 3D model. Please try again.");
        setCreationStep('nameCharacter'); // Stay on naming step if error
    } finally {
        setIsGeneratingConcepts(false);
    }
  };

  // Renamed: Starts background generation (model + maybe rig later) when proceeding from concept select
  const startBackgroundGeneration = async () => {
    if (selectedConceptIndex === null) {
      setError("Please select a concept first.");
      return;
    }

    setError(null);
    setBackgroundTaskRunning(true); // Indicate background work started
    setIsModelComplete(false);
    setIsRigComplete(false);
    setTaskProgress(0);
    setTaskStatus("Initializing...");
    stopPolling(); // Ensure no previous polling

    const newCharacterId = uuidv4();
    setCharacterId(newCharacterId);
    setModelTaskId(null); 
    setRiggingTaskId(null);
    const selectedImageUrl = conceptImages[selectedConceptIndex]?.url;

    try {
      console.log(`Initiating background tasks for character ${newCharacterId}`);
      const response = await fetch('/api/initiate-character', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
              characterId: newCharacterId, 
              imageUrl: selectedImageUrl, 
              prompt: prompt // Pass the prompt here
          }),
      });

      if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to initiate character creation.");
      }
      const result = await response.json();
      if (!result.taskId) throw new Error("API did not return a model task ID.");

      console.log("Model Task ID received:", result.taskId);
      setTaskStatus("Generating 3D model (0%)...");
      setModelTaskId(result.taskId); // Start polling for model task
      setCreationStep('nameCharacter'); // Proceed to naming step immediately

    } catch (err: any) {
      console.error("Background generation initiation failed:", err);
      setError(err.message || "Failed to start background generation.");
      setBackgroundTaskRunning(false);
      setCharacterId(null);
      // Stay on concept selection step on error here
    }
  };

  // Saves the name and marks it as confirmed, DOES NOT NAVIGATE
  const handleNameFinalization = async () => {
    if (characterName.trim().length === 0) {
      setError("Please enter or select a name.");
      return;
    }
    if (!characterId) {
      setError("Cannot save name: Character ID is missing.");
      return;
    }
    setError(null);
    console.log(`[CreatePage] Calling API to save final name: ${characterName} for character: ${characterId}`);

    try {
      // Call the new API route instead of direct Supabase update
      const response = await fetch('/api/update-character-name', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          characterId: characterId, 
          name: characterName.trim() 
        }),
      });

      if (!response.ok) {
        // Try to parse the error message from the API response
        let errorMessage = `Failed to save name (HTTP ${response.status})`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          // Ignore if response body isn't valid JSON
          console.error("Failed to parse error response from /api/update-character-name");
        }
        throw new Error(errorMessage);
      }

      const result = await response.json(); // Read the success response
      
      if (result.success) {
          console.log("[CreatePage] Character name saved successfully via API.");
          setIsNameConfirmed(true); // <-- Mark name as confirmed
      } else {
          // This case shouldn't happen if API returns correct structure, but good to handle
          throw new Error("API indicated name save failed.");
      }
      // Navigation is handled by the useEffect hook now

    } catch (error: any) {
      console.error("[CreatePage] Error calling API to save character name:", error);
      setError(error.message || "Failed to save character name.");
      // Keep isNameConfirmed false if error occurs
    }
  };

  // Polling Effect
  const pollTaskStatus = useCallback(async (taskId: string, isRiggingTask: boolean = false) => {
      console.log(`Polling for task ${taskId} (Rigging: ${isRiggingTask})`);
      try {
          const response = await fetch(`/api/task-status/${taskId}`);
          if (!response.ok) {
              // Stop polling on definitive errors (like 404 Not Found)
              if (response.status === 404) {
                  console.error(`Polling failed: Task ${taskId} not found.`);
                  setError(`Task ${taskId} not found. Please try again or go back.`);
                  stopPolling();
                  setBackgroundTaskRunning(false);
                  // Decide where to send user - maybe concept select? 
                  // setCreationStep('selectConcept'); 
              } else {
                  const errorData = await response.json().catch(() => ({})); // Try parsing error
                  console.error(`Polling error ${response.status}:`, errorData.error || response.statusText);
                  // Don't stop polling on temporary server errors (e.g., 5xx) yet
                  // Could add retry limit here
                  setTaskStatus(`Error checking status (${response.status})... Retrying...`);
              }
              return;
          }

          const data: TaskStatus = await response.json();
          console.log(`Poll Response (${isRiggingTask ? 'Rig' : 'Model'} Task ${taskId}):`, data);

          // Update progress based on which task it is
          let currentOverallProgress = taskProgress;
          if (data.progress !== undefined) {
               if (isRiggingTask) {
                   // Rigging is 50% to 100%
                   currentOverallProgress = 50 + Math.round(data.progress / 2);
               } else {
                   // Modeling is 0% to 50%
                   currentOverallProgress = Math.round(data.progress / 2);
               }
               // Prevent progress going backwards
               setTaskProgress(prev => Math.max(prev, currentOverallProgress > 100 ? 100 : currentOverallProgress)); 
          }
          
          setTaskStatus(data.status || "Processing..."); // Update status message

          // --- Handle Task Completion --- 
          if (data.status === 'success') {
              stopPolling(); // Stop polling for *this* task ID
              
              if (isRiggingTask) {
                  console.log("Rigging successful! Output:", data.output);
                  setTaskProgress(100);
                  setTaskStatus("Character Ready!");
                  setIsRigComplete(true);
                  setBackgroundTaskRunning(false); // All background work done
                  // TODO: Save final rigged model URL (data.output?.result?.pbr_model?.url ??) to DB and R2
                  console.log("TODO: Save final rigged model to R2/DB");
                  // Maybe auto-finalize name here if name already entered? 
                  // Or enable a final confirmation button. For now, user clicks the button in step 3.

              } else { // Model task succeeded
                  console.log("Model generation successful! Output:", data.output);
                  setTaskProgress(50); // Mark model as 50% done
                  setTaskStatus("Starting rig generation...");
                  setIsModelComplete(true);
                  
                  // --- Trigger Rigging Task --- 
                  const startRigging = async () => {
                      if (!characterId) { // Guard against missing character ID
                          console.error("Cannot start rigging: Character ID is missing.");
                          setError("Cannot start rigging: Character ID is missing.");
                          setBackgroundTaskRunning(false);
                      }
                      try {
                          console.log("Initiating rigging task for model task ID:", taskId);
                          const rigResponse = await fetch('/api/rig-character', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ modelTaskId: taskId, characterId: characterId }),
                          });
                          if (!rigResponse.ok) {
                              const errorData = await rigResponse.json();
                              throw new Error(errorData.error || "Failed to start rigging task.");
                          }
                          const rigResult = await rigResponse.json();
                          if (!rigResult.riggingTaskId) throw new Error ("API did not return rigging task ID.");
                          
                          console.log("Rigging Task ID received:", rigResult.riggingTaskId);
                          setRiggingTaskId(rigResult.riggingTaskId); // Start polling for the new task
                          setTaskStatus("Generating rig (50%)...");

                      } catch (rigError: any) {
                           console.error("Failed to start rigging:", rigError);
                           setError("Failed to start character rigging.");
                           setBackgroundTaskRunning(false);
                      }
                  };
                  startRigging(); // Call the async function to start rigging
              }

          } else if (data.status === 'failed' || data.status === 'error') {
              stopPolling();
              console.error(`Tripo task ${taskId} failed:`, data);
              setError(`Process failed during ${isRiggingTask ? 'rigging' : 'model generation'}: ${data.status}`);
              setBackgroundTaskRunning(false);
              // Maybe allow retry or force user back?
          }
          // Continue polling if status is pending, queue, running etc.

      } catch (err) {
          console.error("Error during polling fetch:", err);
          // Don't stop polling on network errors immediately, could be temporary
          setTaskStatus("Network error checking status... Retrying...");
      }
  }, [taskProgress, characterId]); // Added characterId to dependencies

  // Start/Stop Polling Logic (Now handles switching tasks)
  useEffect(() => {
    const currentTaskId = riggingTaskId ?? modelTaskId; // Poll rigging ID if available, else model ID
    const isRigTask = !!riggingTaskId; // Check if we are polling the rigging task

    if (currentTaskId && backgroundTaskRunning && !pollingIntervalRef.current) {
      // Start polling if we have a task ID, background process is active, and not already polling
      pollingIntervalRef.current = setInterval(() => {
        pollTaskStatus(currentTaskId, isRigTask);
      }, 5000); 
      console.log(`Started polling interval for task ${currentTaskId} (Rigging: ${isRigTask}):`, pollingIntervalRef.current);
    }

    // Cleanup function
    return () => {
        stopPolling(); // Ensure polling stops on component unmount or dependency change
    };
    // Dependencies: restart polling if the target task ID changes or background state changes
  }, [modelTaskId, riggingTaskId, backgroundTaskRunning, pollTaskStatus]); 

  // Helper to explicitly stop polling (e.g., on success/failure/back)
  const stopPolling = () => {
      if (pollingIntervalRef.current) {
        console.log("Stopping polling interval explicitly:", pollingIntervalRef.current);
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
  }

  // Updated function to initiate character creation process
  const initiateCharacterCreation = async () => {
    if (characterName.trim().length === 0) {
      setError("Please enter a name for your fighter.");
      return;
    }
    if (selectedConceptIndex === null) {
      setError("Internal Error: No concept selected.");
      setCreationStep('selectConcept');
      return;
    }

    setError(null);
    setIsGeneratingConcepts(true); 
    setTaskProgress(0);
    setTaskStatus("Initializing...");
    setCreationStep('finalize');
    stopPolling(); // Ensure no previous polling is running

    const newCharacterId = uuidv4();
    setCharacterId(newCharacterId);
    setModelTaskId(null); // Reset task ID
    const selectedImageUrl = conceptImages[selectedConceptIndex]?.url;

    try {
      console.log(`Initiating character ${newCharacterId} - ${characterName}`);
      const response = await fetch('/api/initiate-character', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              characterId: newCharacterId,
              characterName: characterName.trim(),
              imageUrl: selectedImageUrl
          }),
      });

      if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to initiate character creation.");
      }

      const result = await response.json();
      console.log("Initiation result:", result);
      
      if (!result.taskId) {
          throw new Error("API did not return a task ID.");
      }

      setTaskStatus("Generating 3D model...");
      setModelTaskId(result.taskId); // <-- Store the task ID to start polling
      // Polling will start automatically via the useEffect hook

    } catch (err: any) {
      console.error("Character initiation failed:", err);
      setError(err.message || "Failed to start character creation.");
      setIsGeneratingConcepts(false);
      setCreationStep('nameCharacter'); 
      setCharacterId(null);
      stopPolling(); // Stop polling on error
    }
  };

  // Updated Back Handler to stop polling
   const handleGoBack = () => {
     setError(null);
     stopPolling(); // Stop polling if user goes back
     setIsGeneratingConcepts(false); // Reset loading state
     setModelTaskId(null); // Clear task ID
     setTaskProgress(0);
     setTaskStatus("");

     if (creationStep === 'selectConcept') {
         setCreationStep('prompt');
         setConceptImages([]);
         setSelectedConceptIndex(null);
     } else if (creationStep === 'nameCharacter') {
         setCreationStep('selectConcept'); // Go back to concept selection
     } else if (creationStep === 'prompt') {
         router.push('/select');
     }
  }

  // Helper booleans for button disabling (Moved from Home page)
  const canGenerateConcepts = prompt.trim().length > 0 && !isGeneratingConcepts;
  const canReroll = !isGeneratingConcepts && !isGeneratingConcepts; // Can reroll if not busy
  const canProceedToName = selectedConceptIndex !== null && !isGeneratingConcepts && !isGeneratingConcepts;
  const canFinalize = characterName.trim().length > 0 && !isGeneratingConcepts && !isGeneratingConcepts;

  // Determine current step number for display
  const getCurrentStepNumber = () => {
      switch(creationStep) {
          case 'prompt': return 1;
          case 'selectConcept': return 2;
          case 'nameCharacter': return 3;
          case 'finalize': return 4; // Or maybe hide numbering during finalization
          default: return 0;
      }
  }

  const openModal = (imageUrl: string) => {
    setModalImageUrl(imageUrl);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setModalImageUrl(null);
  };

  // --- Effects --- 

  // Fetch name suggestions when entering step 3
  useEffect(() => {
    if (creationStep === 'nameCharacter' && selectedConceptIndex !== null && suggestedNames.length === 0) {
      const fetchNames = async () => {
        setError(null);
        setIsSuggestingNames(true);
        try {
          const selectedImageUrl = conceptImages[selectedConceptIndex!]?.url;
          if (!selectedImageUrl) {
            throw new Error("Selected image URL not found.");
          }
          const response = await fetch('/api/suggest-names', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: selectedImageUrl }),
          });
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Failed to fetch name suggestions.");
          }
          const data = await response.json();
          setSuggestedNames(data.names || []);
        } catch (err: any) {
          console.error("Error fetching names:", err);
          setError("Could not load name suggestions. Please enter one manually.");
          setSuggestedNames([]); // Clear suggestions on error
        } finally {
          setIsSuggestingNames(false);
        }
      };
      fetchNames();
    }
    // Clear suggestions if we leave the naming step
    if (creationStep !== 'nameCharacter') {
        setSuggestedNames([]);
    }
  }, [creationStep, selectedConceptIndex, conceptImages, suggestedNames.length]);

  // Effect to handle automatic navigation AFTER name confirmation AND task completion
  useEffect(() => {
      if (isNameConfirmed && isRigComplete && characterId) {
          console.log("Name confirmed and tasks complete. Navigating now...");
          router.push(`/character/${characterId}`);
      }
      // Dependencies ensure this runs when confirmation status or completion status changes
  }, [isNameConfirmed, isRigComplete, characterId, router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-start p-4 pt-12 sm:pt-16 w-full">
        {/* Error Display */}
        {error && (
            <div className="fixed top-5 left-1/2 transform -translate-x-1/2 bg-logo-red text-arcade-white p-3 rounded shadow-arcade-md z-50 border-2 border-black min-w-[300px]">
                <span className="font-bold">ERROR:</span> {error}
            </div>
        )}

        {/* Modal for Zoomed Image */} 
        {isModalOpen && modalImageUrl && (
            <div 
                className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 flex items-center justify-center p-4 cursor-pointer" 
                onClick={closeModal} // Close on overlay click
            >
                <div className="relative w-full h-full max-w-3xl max-h-[85vh]" onClick={(e) => e.stopPropagation()}> {/* Prevent closing when clicking image itself */} 
                    <Image 
                        src={modalImageUrl} 
                        alt="Zoomed Concept Image"
                        fill
                        style={{ objectFit: 'contain' }}
                        className="rounded-lg"
                        unoptimized={true} // Assuming Replicate URLs
                    />
                     <button 
                        onClick={closeModal}
                        className="absolute top-2 right-2 btn-arcade btn-arcade-danger !m-0 !p-1 !text-lg leading-none z-50"
                        title="Close"
                    >
                        X
                    </button>
                </div>
            </div>
        )}

        {/* Main Content Area */} 
        <div className="text-center w-full max-w-4xl flex flex-col flex-grow"> {/* Increased max-width slightly */} 
            <h1 className="text-5xl font-bold mb-10 text-arcade-white drop-shadow-[3px_3px_0_rgba(0,0,0,0.8)]">
                Create Your Fighter
            </h1>

            {/* --- Step 1: Prompt --- */} 
            {creationStep === 'prompt' && (
                <div className="flex flex-col items-center w-full flex-grow justify-center">
                    <div className="w-full mb-6">
                        <label htmlFor="prompt" className="label-arcade">1. Describe your fighter:</label>
                        <textarea
                          id="prompt"
                          rows={3}
                          value={prompt}
                          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
                          className="input-arcade"
                          placeholder="A cyborg ninja with neon green highlights"
                          disabled={isGeneratingConcepts}
                        />
                    </div>
                    <button
                        onClick={handleGenerateConcepts}
                        disabled={!canGenerateConcepts}
                        className={`btn-arcade ${canGenerateConcepts ? "btn-arcade-action" : "btn-arcade-disabled"}`}
                    >
                        {isGeneratingConcepts ? 'Generating...' : 'Generate Concepts'}
                    </button>
                </div>
            )}
            
            {/* --- Step 2: Select Concept --- */} 
            {creationStep === 'selectConcept' && (
                <div className="flex flex-col items-center w-full flex-grow justify-center">
                    <h2 className={`label-arcade text-2xl mb-4 text-center`}> 
                      {getCurrentStepNumber()}. Select a Concept (Click image to zoom)
                    </h2>
                    {/* Concept Display Area - Adjusted styling */} 
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 card-arcade w-full mb-4"> {/* Reduced gap and mb */} 
                        {/* Concept Images */} 
                        {conceptImages.map((img, index) => (
                            <div
                                key={img.id}
                                // Increased height, added zoom onClick
                                className={`relative w-full h-80 sm:h-96 bg-arcade-bg rounded-md flex items-center justify-center text-arcade-white cursor-pointer border-4 outline outline-1 outline-black/50 transition-all duration-150 overflow-hidden group
                                    ${selectedConceptIndex === index 
                                    ? 'border-arcade-blue scale-105 shadow-lg shadow-arcade-blue/30' 
                                    : 'border-arcade-dark-gray hover:border-arcade-white'}`}
                                onClick={() => {
                                    if (!isGeneratingConcepts && !isGeneratingConcepts) {
                                        setSelectedConceptIndex(index); // Select on click
                                        // We could optionally open modal only on a separate button/icon
                                        // openModal(img.url); 
                                    }
                                }}
                                title="Click to select this concept"
                            >
                                <Image 
                                    src={img.url} 
                                    alt={img.alt} 
                                    fill
                                    style={{ objectFit: 'contain' }}
                                    className="absolute inset-0 z-0 transition-transform duration-200 group-hover:scale-105" 
                                    onError={() => console.error(`Failed to load image: ${img.url}`)}
                                    priority={index < 2}
                                    unoptimized={true}
                                /> 
                                 {/* Zoom Button Overlay */} 
                                 <button 
                                     onClick={(e) => { 
                                         e.stopPropagation(); // Prevent selection when clicking zoom 
                                         openModal(img.url); 
                                     }} 
                                     className="absolute top-2 right-2 z-10 p-1.5 bg-black/60 rounded-full text-arcade-white hover:bg-arcade-blue hover:text-black transition-colors"
                                     title="Zoom Image"
                                 >
                                     {/* Basic Zoom Icon (SVG) */} 
                                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                         <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                                     </svg>
                                 </button>
                            </div>
                        ))}
                    </div>
                    {/* Action Buttons for Step 2 */}
                    <div className="flex flex-col sm:flex-row gap-4 mb-4">
                        <button
                            onClick={handleReroll}
                            disabled={!canReroll}
                            className={`btn-arcade ${canReroll ? "btn-arcade-primary" : "btn-arcade-disabled"}`}
                        >
                            {isGeneratingConcepts ? 'Generating...' : 'Reroll Concepts'}
                        </button>
                         <button
                            onClick={startBackgroundGeneration}
                            disabled={!canProceedToName || backgroundTaskRunning}
                            className={`btn-arcade ${(!canProceedToName || backgroundTaskRunning) ? "btn-arcade-disabled" : "btn-arcade-secondary"}`}
                        >
                            {backgroundTaskRunning ? "Working..." : "Next: Name Character"}
                        </button>
                    </div>
                </div>
            )}
            
            {/* --- Step 3: Name Character --- */} 
            {creationStep === 'nameCharacter' && (
                <div className="flex flex-col items-center w-full flex-grow justify-center">
                    {/* Progress Indicator */} 
                    {backgroundTaskRunning && !isRigComplete && (
                         <div className='mb-6 w-full max-w-md'>
                             <p className='text-arcade-blue animate-pulse mb-2'>{taskStatus} ({taskProgress}%)</p>
                             <div className="bg-arcade-dark-gray rounded-full h-3 overflow-hidden border border-black">
                                <div className="bg-arcade-green h-full rounded-full transition-all duration-300" style={{ width: `${taskProgress}%` }}></div>
                            </div>
                         </div>
                    )}
                    {isRigComplete && (
                        <p className='text-arcade-green mb-6 text-xl'>&#x2714; 3D Model Ready!</p>
                    )}

                    {/* Name Input - Always enabled until confirmation (if desired then) */}
                    <div className={`w-full max-w-lg mb-4`}> 
                        <label htmlFor="name" className="label-arcade">{getCurrentStepNumber()}. Name your fighter:</label>
                         <input
                          type="text"
                          id="name"
                          value={characterName}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setCharacterName(e.target.value)}
                          className="input-arcade text-center text-xl"
                          placeholder="Enter Name"
                          disabled={false} // <-- Always enabled
                        />
                    </div>
                    {/* Suggested Names - Always enabled */} 
                    <div className={`mb-6 h-16`}> 
                         {isSuggestingNames && <p className="text-arcade-blue animate-pulse">Suggesting names...</p>}
                         {!isSuggestingNames && suggestedNames.length > 0 && (
                             <div className="flex gap-2 sm:gap-4 justify-center flex-wrap">
                                 {suggestedNames.map(name => (
                                     <button 
                                         key={name}
                                         onClick={() => setCharacterName(name)} 
                                         className="btn-arcade btn-arcade-primary !text-base !py-1 !px-3"
                                         title={`Use name "${name}"`}
                                         disabled={false} // <-- Always enabled
                                     >
                                         {name}
                                     </button>
                                 ))}
                             </div>
                         )}
                         {!isSuggestingNames && suggestedNames.length === 0 && error && 
                             <p className="text-arcade-gray">(Could not load suggestions)</p> }
                    </div>
                   
                    {/* Finalize Button */} 
                     <button
                        onClick={handleNameFinalization} 
                        disabled={characterName.trim().length === 0 || isNameConfirmed} // Disable if name empty OR already confirmed
                        className={`btn-arcade ${characterName.trim().length === 0 || isNameConfirmed ? "btn-arcade-disabled" : "btn-arcade-secondary"} w-60`}
                    >
                        {isNameConfirmed 
                            ? (isRigComplete ? "Confirmed" : "Processing...") 
                            : "Confirm Name"
                        } 
                    </button>
                </div>
            )}

            {/* --- Step 4: Finalize (Combined Progress/Loading) --- */}
            {/* This step might become redundant or just show final confirmation? */}
            {/* For now, let's remove the separate step 4 UI */}

            {/* Back Button - Now hidden in finalize step */} 
            {creationStep !== 'finalize' && (
                 <div className="mt-auto pt-10 pb-5"> 
                     <button
                      onClick={handleGoBack}
                      disabled={isGeneratingConcepts || isSuggestingNames || backgroundTaskRunning}
                      className={`btn-arcade ${(isGeneratingConcepts || isSuggestingNames || backgroundTaskRunning) ? 'btn-arcade-disabled' : 'btn-arcade-danger'} w-full sm:w-auto`}
                    >
                       Back
                    </button>
                </div>
            )}
        </div>
    </main>
  );
} 