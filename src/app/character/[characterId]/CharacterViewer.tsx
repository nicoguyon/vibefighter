'use client';

import React, { Suspense, useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, Html } from '@react-three/drei';
import * as THREE from 'three';
// Import animation functions and types from the new central location
import { 
    createFightStanceClip, 
    createResetPoseClip, 
    createIdleBreathClip, 
    type EulerOrder, 
    type InitialPoseData, 
    defaultFightStanceTargets
} from '../../../lib/animations/clips';

// Specific type for the mixer 'finished' event
interface AnimationFinishedEvent extends THREE.Event {
    type: 'finished';
    action: THREE.AnimationAction;
    direction: number;
}

interface ModelProps {
    url: string;
    setAutoRotate: React.Dispatch<React.SetStateAction<boolean>>;
    setMixer: React.Dispatch<React.SetStateAction<THREE.AnimationMixer | null>>;
    setInitialPose: React.Dispatch<React.SetStateAction<Record<string, InitialPoseData>>>;
    setSkeleton: React.Dispatch<React.SetStateAction<THREE.Skeleton | null>>;
}

function Model({ url, setAutoRotate, setMixer, setInitialPose, setSkeleton }: ModelProps) {
    // useGLTF.preload(url); // Optional: Preload for faster display
    const { scene, animations } = useGLTF(url); // Get animations too if they exist
    const modelRef = useRef<THREE.Group>(null!); // Ref to the model group (THREE.Group)

    // Apply basic transformations if needed
    useEffect(() => {
        if (scene) {
            // Rotate model to face camera (+Z direction)
            scene.rotation.y = -Math.PI / 2;

            // Create and set mixer
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
                // Simplified fallback (less common)
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
                console.log("[Model] Available Bones:");
                // Temporarily ignore TS error, logic is sound due to outer if
                // @ts-ignore 
                foundSkeleton.bones.forEach((bone: THREE.Bone) => {
                    console.log(`- ${bone.name}`);
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
            // Set state even if skeleton/pose is empty/null
            setSkeleton(foundSkeleton);
            setInitialPose(pose);
        }

        // Cleanup mixer on component unmount or scene change
        return () => {
            setMixer(null);
            setInitialPose({});
            setSkeleton(null);
        };

    }, [scene, setMixer, setInitialPose, setSkeleton, animations]);

    // Stop auto-rotation when user interacts
    const handleInteraction = useCallback(() => {
        if (setAutoRotate) setAutoRotate(false);
    }, [setAutoRotate]);

    // Pointer events for interaction detection
    const pointerEvents = useMemo(() => ({
        onPointerDown: handleInteraction,
        onWheel: handleInteraction,
    }), [handleInteraction]);

    return <primitive object={scene} ref={modelRef} {...pointerEvents} />;
}

// New component to handle the animation loop inside Canvas
interface AnimationRunnerProps {
    mixer: THREE.AnimationMixer | null;
}

function AnimationRunner({ mixer }: AnimationRunnerProps) {
    useFrame((_, delta) => {
        mixer?.update(delta);
    });
    return null; // This component doesn't render anything itself
}

// --- CharacterViewer Component ---
interface CharacterViewerProps { 
    modelUrl: string;
}

export default function CharacterViewer({ modelUrl }: CharacterViewerProps) {
    const [autoRotate, setAutoRotate] = useState(true);
    const [mixer, setMixer] = useState<THREE.AnimationMixer | null>(null);
    const [initialPose, setInitialPose] = useState<Record<string, InitialPoseData>>({});
    const [skeleton, setSkeleton] = useState<THREE.Skeleton | null>(null);
    const [resetPoseAction, setResetPoseAction] = useState<THREE.AnimationAction | null>(null);
    const [fightStanceAction, setFightStanceAction] = useState<THREE.AnimationAction | null>(null);
    const [idleBreathAction, setIdleBreathAction] = useState<THREE.AnimationAction | null>(null); // <-- New State
    const [isPlaying, setIsPlaying] = useState(false); // True if stance OR breathing is active

    // Use the imported defaultFightStanceTargets directly
    const fightStanceTargets = defaultFightStanceTargets;

    // --- Log state changes (Keep) ---
    useEffect(() => { console.log("[Viewer] Mixer updated:", !!mixer); }, [mixer]);
    useEffect(() => { console.log("[Viewer] Skeleton updated:", !!skeleton); }, [skeleton]);
    useEffect(() => { console.log("[Viewer] Initial Pose updated:", Object.keys(initialPose).length, "bones"); }, [initialPose]);

    // --- Create Animation Actions & Setup Listener --- 
    useEffect(() => {
        if (mixer && skeleton && Object.keys(initialPose).length > 0) {
            // Keep track of actions created in this effect run for listener closure
            let localStanceAction: THREE.AnimationAction | null = null;
            let localResetAction: THREE.AnimationAction | null = null;
            let localIdleAction: THREE.AnimationAction | null = null;

            // Create Fight Stance Action
            const stanceClip = createFightStanceClip(skeleton, initialPose, fightStanceTargets, 'FightStance');
            if (stanceClip) {
                localStanceAction = mixer.clipAction(stanceClip);
                localStanceAction.setLoop(THREE.LoopOnce, 1);
                localStanceAction.clampWhenFinished = true;
                setFightStanceAction(localStanceAction); // Update state
                console.log("[Viewer] Fight Stance Action created.");
            } else { console.error("[Viewer] Failed to create Fight Stance Clip/Action."); }

            // Create Reset Action
            const resetClip = createResetPoseClip(skeleton, initialPose);
            if (resetClip) {
                localResetAction = mixer.clipAction(resetClip);
                localResetAction.setLoop(THREE.LoopOnce, 1);
                localResetAction.clampWhenFinished = true;
                setResetPoseAction(localResetAction); // Update state
                console.log("[Viewer] Reset Pose Action created.");
            } else { console.error("[Viewer] Failed to create Reset Pose Clip/Action."); }
            
            // Create Idle Breath Action
            const breathClip = createIdleBreathClip(skeleton, fightStanceTargets, initialPose);
            if (breathClip) {
                localIdleAction = mixer.clipAction(breathClip);
                localIdleAction.setLoop(THREE.LoopRepeat, Infinity);
                setIdleBreathAction(localIdleAction); // Update state
                 console.log("[Viewer] Idle Breath Action created.");
            } else { console.error("[Viewer] Failed to create Idle Breath Clip/Action."); }

            // Single listener for all actions
            const onAnimationFinished = (event: AnimationFinishedEvent) => {
                // Check which action finished
                if (localStanceAction && event.action === localStanceAction) {
                    console.log("[Viewer] Fight Stance Finished. Starting Idle Breath.");
                     if (localIdleAction) {
                         localIdleAction.reset().fadeIn(0.3).play(); // Fade in breathing
                         // Keep isPlaying = true
                     }
                } else if (localResetAction && event.action === localResetAction) {
                    console.log("[Viewer] Reset Pose Finished.");
                    setIsPlaying(false); // Now set to false
                    setAutoRotate(true); // Re-enable auto-rotate after reset
                }
            };

            mixer.addEventListener('finished', onAnimationFinished);
            console.log("[Viewer] Added 'finished' listener.");

            // Cleanup function
            return () => {
                 console.log("[Viewer] Cleaning up actions and listener.");
                if (mixer) {
                     mixer.removeEventListener('finished', onAnimationFinished);
                     // Stop actions associated with *this specific effect run* 
                     localStanceAction?.stop();
                     localResetAction?.stop();
                     localIdleAction?.stop();
                }
                 // Clear state on cleanup as well
                 setFightStanceAction(null);
                 setResetPoseAction(null);
                 setIdleBreathAction(null);
            };
        }
    }, [mixer, skeleton, initialPose, fightStanceTargets]); // Rerun when these change

    // --- Play Fight Stance Sequence Handler --- 
    const playFightStanceSequence = useCallback(() => {
        // Use state variables directly here
        if (!fightStanceAction || !mixer) {
             console.warn("Cannot play stance sequence: Action or Mixer missing.");
            return;
        }
        console.log("[Viewer] Triggering Fight Stance...");
        setIsPlaying(true);
        setAutoRotate(false);
        
        // Stop other actions cleanly using fades
        resetPoseAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2); 
        
        // Play stance with fade in
        fightStanceAction.reset().fadeIn(0.2).play();

    }, [fightStanceAction, resetPoseAction, idleBreathAction, mixer, setAutoRotate]); // Dependencies

    // --- Reset Pose Handler --- 
    const triggerResetPose = useCallback(() => {
         // Use state variables directly here
        if (!resetPoseAction || !mixer) {
             console.warn("Cannot play reset sequence: Action or Mixer missing.");
            return;
        }
        console.log("[Viewer] Triggering Reset Pose...");
        setIsPlaying(false); // Indicate we are returning to idle
        setAutoRotate(false); // Keep off until reset finishes via the listener

        // Stop other actions cleanly using fades
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2); 

        // Play reset with fade in
        resetPoseAction.reset().fadeIn(0.2).play();

    }, [resetPoseAction, fightStanceAction, idleBreathAction, mixer, setAutoRotate]); // Dependencies

    return (
        <>
            <div className="relative w-full h-screen bg-gradient-to-br from-arcade-dark-gray to-arcade-bg">
                {/* Button Layout - Adjust disabled logic */} 
                 <div className="absolute top-24 left-4 z-10 flex flex-col gap-2"> 
                     <button
                        onClick={playFightStanceSequence}
                        // Disable if actions aren't ready OR if currently playing stance/breathing
                        disabled={!fightStanceAction || !resetPoseAction || !idleBreathAction || isPlaying}
                        className={`btn-arcade ${(!fightStanceAction || !resetPoseAction || !idleBreathAction || isPlaying) ? "btn-arcade-disabled" : "btn-arcade-action"}`}
                    >
                        {/* Text can be simple or change based on isPlaying */}
                         Fight Stance
                    </button>
                    <button
                        onClick={triggerResetPose}
                        // Disable only if reset action isn't ready
                        disabled={!resetPoseAction}
                        className={`btn-arcade ${!resetPoseAction ? "btn-arcade-disabled" : "btn-arcade-primary"}`}
                    >
                        Reset Pose
                    </button>
                </div>
                {/* Canvas setup remains the same */}
                <Canvas camera={{ position: [0, 0.5, 1.8], fov: 60 }} shadows >
                     <ambientLight intensity={0.7} />
                     <directionalLight 
                        position={[5, 10, 5]} 
                        intensity={1.0} 
                        castShadow 
                        shadow-mapSize-width={1024} 
                        shadow-mapSize-height={1024} 
                    />
                    <hemisphereLight intensity={0.4} groundColor="#555" />
                     <Suspense fallback={
                        <Html center>
                             <p className="text-arcade-yellow text-xl animate-pulse">Loading Model...</p>
                        </Html>
                    }>
                         <Model url={modelUrl} setAutoRotate={setAutoRotate} setMixer={setMixer} setInitialPose={setInitialPose} setSkeleton={setSkeleton} />
                         <AnimationRunner mixer={mixer} />
                     </Suspense>
                     <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} autoRotate={autoRotate} autoRotateSpeed={1.5} target={[0, 0.5, 0]} onChange={() => { if (autoRotate) setAutoRotate(false); }} />
                </Canvas>
            </div>
        </>
    );
} 