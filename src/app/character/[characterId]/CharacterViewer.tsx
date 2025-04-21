'use client';

import React, { Suspense, useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, Html, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
// Import animation functions and types from the new central location
import { 
    createFightStanceClip, 
    createResetPoseClip, 
    createIdleBreathClip, 
    createRightPunchClip, // Import punch clip
    createLeftPunchClip, // <-- ADDED IMPORT
    type EulerOrder, 
    type InitialPoseData, 
    defaultFightStanceTargets,
    type StartPose // <-- ADD IMPORT BACK
} from '../../../lib/animations/clips';

// --- NEW: Component to manage WebGL Context Cleanup ---
interface WebGLContextManagerProps {
    mixer: THREE.AnimationMixer | null;
    onAnimationFinished: (event: AnimationFinishedEvent) => void;
    // Pass other necessary dependencies if the cleanup effect needs them
}

function WebGLContextManager({ mixer, onAnimationFinished }: WebGLContextManagerProps) {
    const { gl } = useThree(); // Get gl instance here, INSIDE Canvas context

    useEffect(() => {
        // Return cleanup function
        return () => {
            console.log("[Viewer ContextManager] Component unmounting: Cleaning up GL context.");
            // Stop all animations and remove listeners if mixer exists (if cleanup logic moved here)
            // if (mixer) {
            //     mixer.stopAllAction();
            //     mixer.removeEventListener('finished', onAnimationFinished);
            //     console.log("[Viewer ContextManager] Cleanup: Stopped mixer and removed listener.");
            // }

            // --- Explicitly dispose of WebGL resources ---
            console.log("[Viewer ContextManager] Cleanup: Calling gl.dispose().");
            gl.dispose();
        };
    // Add gl, mixer, onAnimationFinished to dependency array
    }, [gl, mixer, onAnimationFinished]);

    return null; // This component doesn't render anything visual
}

// Specific type for the mixer 'finished' event
interface AnimationFinishedEvent extends THREE.Event {
    type: 'finished';
    action: THREE.AnimationAction;
    direction: number;
}

interface ModelProps {
    url: string;
    // setAutoRotate: React.Dispatch<React.SetStateAction<boolean>>; // No longer needed
    setMixer: React.Dispatch<React.SetStateAction<THREE.AnimationMixer | null>>;
    setInitialPose: React.Dispatch<React.SetStateAction<Record<string, InitialPoseData>>>;
    setSkeleton: React.Dispatch<React.SetStateAction<THREE.Skeleton | null>>;
}

function Model({ url, /* setAutoRotate, */ setMixer, setInitialPose, setSkeleton }: ModelProps) {
    const { scene } = useGLTF(url);
    const modelRef = useRef<THREE.Group>(null!); 

    useEffect(() => {
        if (scene) {
            // scene.rotation.y = -Math.PI / 2; // <<< REMOVE THIS LINE: Do not modify cached scene
            const mixerInstance = new THREE.AnimationMixer(scene);
            setMixer(mixerInstance);
            let foundSkeleton: THREE.Skeleton | null = null;
            const pose: Record<string, InitialPoseData> = {};
            scene.traverse((child) => {
                if (child instanceof THREE.SkinnedMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    if (child.skeleton instanceof THREE.Skeleton) {
                        foundSkeleton = child.skeleton;
                    }
                }
                if (!foundSkeleton && child instanceof THREE.Bone) {
                    let parent = child.parent;
                    while(parent && !(parent as any).skeleton) parent = parent.parent;
                    if(parent && (parent as any).skeleton instanceof THREE.Skeleton) {
                        foundSkeleton = (parent as any).skeleton;
                    }
                }
            });
            if (foundSkeleton) {
                console.log("--- [Model] Found Skeleton ---");
                // Explicitly type skeleton here to satisfy linter after check
                (foundSkeleton as THREE.Skeleton).bones.forEach((bone: THREE.Bone) => {
                    // console.log(`- ${bone.name}`); // Reduce console spam
                    pose[bone.name] = {
                        pos: bone.position.clone(),
                        quat: bone.quaternion.clone(),
                        scale: bone.scale.clone()
                    };
                });
                console.log("-----------------------------");
            } else {
                console.warn("[Model] Could not find skeleton.");
            }
            setSkeleton(foundSkeleton);
            setInitialPose(pose);
        }
        return () => {
            setMixer(null);
            setInitialPose({});
            setSkeleton(null);
        };
    }, [scene, setMixer, setInitialPose, setSkeleton]); // Removed animations dependency

    // Removed interaction handler and pointer events as auto-rotate is always on

    return <primitive object={scene} ref={modelRef} />;
}

// --- AnimationRunner Component (no changes) --- 
interface AnimationRunnerProps {
    mixer: THREE.AnimationMixer | null;
}
function AnimationRunner({ mixer }: AnimationRunnerProps) {
    useFrame((_, delta) => {
        mixer?.update(delta);
    });
    return null; 
}

// --- CharacterViewer Component --- 
interface CharacterViewerProps { 
    modelUrl: string;
    nameAudioUrl?: string; // Add optional audio URL prop
}

export default function CharacterViewer({ modelUrl, nameAudioUrl }: CharacterViewerProps) {
    // const [autoRotate, setAutoRotate] = useState(true); // Removed, always auto-rotate
    const [mixer, setMixer] = useState<THREE.AnimationMixer | null>(null);
    const [initialPose, setInitialPose] = useState<Record<string, InitialPoseData>>({});
    const [skeleton, setSkeleton] = useState<THREE.Skeleton | null>(null);
    const [actionsReady, setActionsReady] = useState<boolean>(false); // <-- New state flag
    const [resetPoseAction, setResetPoseAction] = useState<THREE.AnimationAction | null>(null);
    const [fightStanceAction, setFightStanceAction] = useState<THREE.AnimationAction | null>(null);
    const [idleBreathAction, setIdleBreathAction] = useState<THREE.AnimationAction | null>(null); 
    const [audioPlayed, setAudioPlayed] = useState(false); // Track audio playback
    const punchIntervalRef = useRef<NodeJS.Timeout | null>(null); // Ref for punch interval timer
    const comboTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref for combo restart timer
    const stanceTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref for initial stance delay timeout
    // const { gl } = useThree(); // <<< REMOVE useThree from here

    const fightStanceTargets = defaultFightStanceTargets;

    // --- Play Audio Once --- 
    useEffect(() => {
        if (nameAudioUrl && !audioPlayed) {
            console.log("[Viewer] Playing name audio:", nameAudioUrl);
            const audio = new Audio(nameAudioUrl);
            audio.play().catch(err => console.error("Audio playback failed:", err));
            setAudioPlayed(true); // Ensure it plays only once
        }
    }, [nameAudioUrl, audioPlayed]);

    // --- Play Specific Punch Function --- 
    const playSpecificPunch = useCallback((punchType: 'right' | 'left') => {
        console.log(`[Viewer] Attempting to play ${punchType} punch.`);
        // Check necessary components
        if (!mixer || !skeleton || !idleBreathAction || Object.keys(initialPose).length === 0) {
            console.warn(`[Viewer] playSpecificPunch: Cannot play ${punchType} punch - Missing Mixer, Skeleton, IdleAction, or InitialPose.`);
            // Don't automatically retry here, let the sequence handle it.
            return;
        }
        
        console.log(`[Viewer] playSpecificPunch: Capturing pose for ${punchType} punch...`);
        const punchTypeToCreate = punchType; // Use the argument
        const clipName = punchTypeToCreate === 'right' ? 'RightPunch' : 'LeftPunch';
        console.log(`[Viewer] playSpecificPunch: Creating ${punchTypeToCreate} punch clip with name ${clipName}...`);
        
        // 1. Capture Current Pose
        const currentPose: StartPose = {};
        skeleton.bones.forEach(bone => {
            currentPose[bone.name] = { quat: bone.quaternion.clone() };
        });
        
        // 2. Create Clip Dynamically based on type
        const punchClip = punchTypeToCreate === 'right' 
           ? createRightPunchClip(
                 skeleton,
                 initialPose,
                 fightStanceTargets,
                 currentPose, // Use the captured pose
                 clipName // Use the correct clip name
             ) 
           : createLeftPunchClip(
                 skeleton,
                 initialPose,
                 fightStanceTargets,
                 currentPose, // Use the captured pose
                 clipName // Use the correct clip name
             );

        console.log(`[Viewer] playSpecificPunch: Clip creation result for ${clipName}:`, punchClip); // Log clip result
        if (!punchClip) {
            console.error(`[Viewer] playSpecificPunch: Failed to create dynamic ${punchTypeToCreate} punch clip.`);
            // Schedule retry if clip creation fails
            if (punchIntervalRef.current) clearTimeout(punchIntervalRef.current);
            punchIntervalRef.current = setTimeout(() => playSpecificPunch(punchType), Math.random() * 2000 + 3000); 
            return;
        }

        // 3. Create and Play Action
        const punchAction = mixer.clipAction(punchClip);
        punchAction.setLoop(THREE.LoopOnce, 1);
        punchAction.clampWhenFinished = true; // Clamp at the end (important? Maybe not needed if idle restarts)

        console.log(`[Viewer] playSpecificPunch: Playing dynamic ${punchTypeToCreate} punch action (${clipName}).`);
        idleBreathAction.stop(); // Stop idle breath FIRST
        punchAction.reset().fadeIn(0.2).play(); // Play the dynamic action

    // Depend on components needed for dynamic creation & idle action
    }, [mixer, skeleton, initialPose, fightStanceTargets, idleBreathAction]); 

    // --- Function to Start the Right-Left Combo ---
    const startRightLeftCombo = useCallback(() => {
        console.log("[Viewer] Starting Right-Left Combo sequence.");
        if (comboTimeoutRef.current) {
             clearTimeout(comboTimeoutRef.current); // Clear any pending restart timer
             comboTimeoutRef.current = null;
        }
        playSpecificPunch('right'); // Always start combo with Right
        
        // No need to schedule the *next* combo start here, 
        // it will be scheduled when the Left punch finishes.

    }, [playSpecificPunch]);

    // --- Animation Finished Listener (Check Clip Name) --- 
    const onAnimationFinished = useCallback((event: AnimationFinishedEvent) => {
        console.log(`[Viewer] Finished Listener: Detected finished action for clip: ${event.action.getClip().name}`); // Log detected clip name

        if (punchIntervalRef.current) {
            console.log("[Viewer] Finished Listener: Clearing existing punch timer.");
            clearTimeout(punchIntervalRef.current);
            punchIntervalRef.current = null; 
        }

        if (fightStanceAction && event.action === fightStanceAction) {
            console.log("[Viewer] Finished Listener (Stance): Fight Stance Finished. Starting Idle Breath.");
            idleBreathAction?.reset().setEffectiveWeight(1).fadeIn(0.3).play(); 
            if (comboTimeoutRef.current) { clearTimeout(comboTimeoutRef.current); comboTimeoutRef.current = null; } // Clear pending combo restarts
            console.log("[Viewer] Finished Listener (Stance): Calling startRightLeftCombo for the first time."); 
            // Use a small delay before the first combo starts after stance
            comboTimeoutRef.current = setTimeout(startRightLeftCombo, 1500 + Math.random() * 1000); 

        } else if (event.action.getClip().name === 'RightPunch') {
            console.log("[Viewer] Finished Listener (Right Punch): Playing Left Punch immediately.");

            // --- Cleanup the dynamic Right Punch action ---
            const finishedAction = event.action;
            const finishedClip = finishedAction.getClip();
            finishedAction.stop(); 
            mixer?.uncacheAction(finishedClip, finishedAction.getRoot());
            mixer?.uncacheClip(finishedClip);
            console.log("[Viewer] Finished Listener (Right Punch): Uncached Right Punch action.");
            // ---------------------------------------------

            playSpecificPunch('left'); // Play Left punch right away

        } else if (event.action.getClip().name === 'LeftPunch') { 
            console.log("[Viewer] Finished Listener (Left Punch): Combo part finished. Cleaning up, returning to Idle, Scheduling next combo."); // Clarify log source
            
            // --- Cleanup the dynamic action --- 
            const finishedAction = event.action;
            const finishedClip = finishedAction.getClip();
            
            // Stop is likely redundant as LoopOnce is used, but doesn't hurt
            finishedAction.stop(); 
            
            // Uncache action and clip to prevent memory leaks
            mixer?.uncacheAction(finishedClip, finishedAction.getRoot());
            mixer?.uncacheClip(finishedClip);
            console.log(`[Viewer] Finished Listener (Left Punch): Uncached dynamic action for clip: ${finishedClip.name}`); // Clarify log source
            // ----------------------------------
            
            idleBreathAction?.reset().setEffectiveWeight(1).fadeIn(0.3).play(); 
            // Schedule the start of the NEXT combo after a pause
            const pauseDuration = 2000 + Math.random() * 1500; // 2-3.5 second pause
            console.log(`[Viewer] Finished Listener (Left Punch): Scheduling NEXT combo start in ${pauseDuration.toFixed(0)}ms.`); 
            if (comboTimeoutRef.current) { clearTimeout(comboTimeoutRef.current); } // Clear any existing timer just in case
            comboTimeoutRef.current = setTimeout(startRightLeftCombo, pauseDuration);
        }
    }, [fightStanceAction, idleBreathAction, playSpecificPunch, startRightLeftCombo, mixer]); 

    // --- Create Animation Actions --- 
    useEffect(() => {
        if (mixer && skeleton && Object.keys(initialPose).length > 0) {
            console.log("[Viewer] Creating/Updating animation actions...");
            let allActionsCreated = true;
            setActionsReady(false); 

            const stanceClip = createFightStanceClip(skeleton, initialPose, fightStanceTargets, 'FightStance', 0.5);
            if (stanceClip) {
                const action = mixer.clipAction(stanceClip).setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
                setFightStanceAction(action);
            } else { console.error("[Viewer] Failed to create Fight Stance."); allActionsCreated = false; }

            const resetClip = createResetPoseClip(skeleton, initialPose, 0.3);
            if (resetClip) {
                const action = mixer.clipAction(resetClip).setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
                setResetPoseAction(action);
            } else { console.error("[Viewer] Failed to create Reset Pose."); }
            
            const breathClip = createIdleBreathClip(skeleton, fightStanceTargets, initialPose, 'IdleBreath', 3.0);
            if (breathClip) {
                const action = mixer.clipAction(breathClip).setLoop(THREE.LoopRepeat, Infinity);
                action.setEffectiveWeight(0); 
                setIdleBreathAction(action);
            } else { console.error("[Viewer] Failed to create Idle Breath."); allActionsCreated = false; }

            if (allActionsCreated) {
                 console.log("[Viewer] All actions created successfully.");
                 setActionsReady(true); 
            }
        }
         // Cleanup: Reset ready state when dependencies change
         return () => {
             setActionsReady(false);
         };
    }, [mixer, skeleton, initialPose, fightStanceTargets, setFightStanceAction, setResetPoseAction, setIdleBreathAction]); // Corrected dependency array

     // --- Add/Remove Mixer Listener --- 
     useEffect(() => {
        if (mixer) {
            console.log("[Viewer] Attaching 'finished' listener to mixer.");
            mixer.addEventListener('finished', onAnimationFinished);
        }
        // Cleanup: Remove listener when mixer changes or component unmounts
        return () => {
            if (mixer) {
                 console.log("[Viewer] Removing 'finished' listener from mixer.");
                 mixer.removeEventListener('finished', onAnimationFinished);
            }
        };
     }, [mixer, onAnimationFinished]); // Depend on mixer instance and stable listener function

    // --- Effect to Trigger Initial Stance --- 
    useEffect(() => {
        if (stanceTimeoutRef.current) {
            clearTimeout(stanceTimeoutRef.current);
            stanceTimeoutRef.current = null;
        }

        if (actionsReady && fightStanceAction) {
            console.log("[Viewer] Actions ready, setting timeout for Fight Stance...");
             stanceTimeoutRef.current = setTimeout(() => {
                 console.log("[Viewer] Timeout finished: Playing Fight Stance!");
                 idleBreathAction?.stop();
                 resetPoseAction?.stop();
                 fightStanceAction.reset().fadeIn(0.3).play();
            }, 500); 
        } else if (actionsReady) {
            console.warn("[Viewer] Actions ready, but fightStanceAction is missing!");
        }

        return () => {
            console.log("[Viewer] Cleaning up initial stance trigger effect...");
            if (stanceTimeoutRef.current) {
                clearTimeout(stanceTimeoutRef.current);
                stanceTimeoutRef.current = null;
                 console.log("[Viewer] Cleared pending stance timeout.");
            }
        };
    }, [actionsReady, fightStanceAction, idleBreathAction, resetPoseAction]); // Corrected dependency array

     // --- General Cleanup Effect on Unmount ( REMOVED gl.dispose() from here) --- 
     useEffect(() => {
         // Return cleanup function
         return () => {
            // console.log("[Viewer] Component unmounting: Cleaning up timeouts, listeners, and GL context.");
            console.log("[Viewer] Component unmounting: Cleaning up timeouts and listeners.");
            // Clear any pending timeouts (like punchTimerRef, stanceTimeoutRef)
            if (punchIntervalRef.current) clearTimeout(punchIntervalRef.current);
            if (comboTimeoutRef.current) clearTimeout(comboTimeoutRef.current); // Clear combo timer
            if (stanceTimeoutRef.current) clearTimeout(stanceTimeoutRef.current);
            
            // Stop all animations and remove listeners if mixer exists
            if (mixer) {
                mixer.stopAllAction();
                mixer.removeEventListener('finished', onAnimationFinished);
                console.log("[Viewer] Cleanup: Stopped mixer and removed listener.");
            }

            // --- Explicitly dispose of WebGL resources (MOVED to ContextManager) ---
            // console.log("[Viewer] Cleanup: Calling gl.dispose().");
            // gl.dispose(); 

            // --- Keep existing logs for reference ---
            // console.log("[Viewer] Removing 'finished' listener from mixer.");
            // console.log("[Viewer] Cleaning up initial stance trigger effect...");
            // console.log("[Viewer] Cleared pending stance timeout.");
            // console.log("[Viewer] Component unmounting: Final cleanup.");
        };
    // Remove gl from dependency array
    // }, [mixer, onAnimationFinished, gl]); 
    }, [mixer, onAnimationFinished]); 

    return (
        <>
            {/* Container maintains full screen */}
            <div className="relative w-full h-screen bg-gradient-to-br from-arcade-dark-gray to-arcade-bg">
                {/* Buttons are removed */}
                 
                 {/* Canvas setup */}
                <Canvas camera={{ position: [1.8, 0.5, 0], fov: 60 }} shadows >
                     <ambientLight intensity={0.7} />
                     <directionalLight 
                        position={[5, 10, 5]} 
                        intensity={1.0} 
                        castShadow 
                        shadow-mapSize-width={1024} 
                        shadow-mapSize-height={1024} 
                    />
                    <hemisphereLight intensity={0.4} groundColor="#555" />
                     <Suspense fallback={ <Html center> <p className="text-arcade-yellow text-xl animate-pulse">Loading Model...</p> </Html> }>
                         {/* Pass setAutoRotate is removed */}
                         <Model url={modelUrl} setMixer={setMixer} setInitialPose={setInitialPose} setSkeleton={setSkeleton} />
                         <AnimationRunner mixer={mixer} />
                         {/* Add the context manager INSIDE the canvas */}
                         <WebGLContextManager mixer={mixer} onAnimationFinished={onAnimationFinished} />
                     </Suspense>
                     {/* OrbitControls always auto-rotates, removed onChange handler */}
                     <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} autoRotate={true} autoRotateSpeed={1.5} target={[0, 0.5, 0]} />
                </Canvas>
            </div>
        </>
    );
} 