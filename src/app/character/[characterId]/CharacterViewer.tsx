'use client';

import React, { Suspense, useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, Html } from '@react-three/drei';
import * as THREE from 'three';

// Define EulerOrder type based on Three.js documentation (adjust if needed based on your Three.js version)
type EulerOrder = 'XYZ' | 'YZX' | 'ZXY' | 'XZY' | 'YXZ' | 'ZYX';

// Specific type for the mixer 'finished' event
interface AnimationFinishedEvent extends THREE.Event {
    type: 'finished';
    action: THREE.AnimationAction;
    direction: number;
}

interface InitialPoseData {
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    scale: THREE.Vector3;
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

// Restore createFightStanceClip function
function createFightStanceClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, any>, 
    boneTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }>, 
    clipName: string = 'FightStance', // Default name
    duration: number = 0.5
): THREE.AnimationClip | null { 
    if (!skeleton || Object.keys(initialPose).length === 0) return null;
    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration];
    const deg = THREE.MathUtils.degToRad;
    console.log(`--- Creating Clip: ${clipName} ---`);
    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const targetInfo = boneTargets[boneName];
        const initial = initialPose[boneName];
        if (!initial) { /* console.warn(`No initial pose for ${boneName}`); */ return; } // Quieten log
        const startQuat: THREE.Quaternion = initial.quat;
        let endQuat = startQuat.clone();
        if (targetInfo?.rotation) {
            const eulerOrder = targetInfo.eulerOrder || 'XYZ';
            const r = targetInfo.rotation;
            const initialEuler = new THREE.Euler().setFromQuaternion(startQuat, eulerOrder);
            const endEulerRad = new THREE.Euler(
                deg(r.x ?? THREE.MathUtils.radToDeg(initialEuler.x)),
                deg(r.y ?? THREE.MathUtils.radToDeg(initialEuler.y)),
                deg(r.z ?? THREE.MathUtils.radToDeg(initialEuler.z)),
                eulerOrder
            );
            endQuat.setFromEuler(endEulerRad);
            // console.log(`  ${boneName} (${eulerOrder}): x:${r.x?.toFixed(1)}, y:${r.y?.toFixed(1)}, z:${r.z?.toFixed(1)}`); // Quieten log
        }
        // Only add track if end is different (or target specified, to be safe)
        if (targetInfo || !endQuat.equals(startQuat)) {
            tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, [startQuat.x, startQuat.y, startQuat.z, startQuat.w, endQuat.x, endQuat.y, endQuat.z, endQuat.w]));
        }
    });
    // console.log("----------------------------------"); // Quieten log
    if (tracks.length === 0) { console.warn(`No tracks generated for ${clipName}.`); return null; }
    return new THREE.AnimationClip(clipName, duration, tracks);
}

// Keep createResetPoseClip function
function createResetPoseClip(skeleton: THREE.Skeleton | null, initialPose: Record<string, any>, duration: number = 0.3): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0) return null;
    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration];
    skeleton.bones.forEach((bone: THREE.Bone) => {
        const initial = initialPose[bone.name];
        if (!initial) return;
        const currentQuat = bone.quaternion;
        tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, [currentQuat.x, currentQuat.y, currentQuat.z, currentQuat.w, initial.quat.x, initial.quat.y, initial.quat.z, initial.quat.w]));
    });
    if (tracks.length === 0) return null;
    return new THREE.AnimationClip('ResetPose', duration, tracks);
}

// --- NEW: Create Idle Breathing Clip Function ---
function createIdleBreathClip(
    skeleton: THREE.Skeleton | null, 
    stancePoseTargets: Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }>, 
    initialPose: Record<string, InitialPoseData>, // Needed for fallback
    clipName: string = 'IdleBreath', 
    duration: number = 3.5, // Duration for one breath cycle
    intensity: number = 0.8 // Degrees of subtle movement - INCREASED from 0.4
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(stancePoseTargets).length === 0 || Object.keys(initialPose).length === 0) {
        console.warn("[IdleBreath] Missing skeleton, stance targets, or initial pose.");
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration / 2, duration]; // Start, Peak, End (back to start)
    const deg = THREE.MathUtils.degToRad;

    // Bones to animate for breathing (Using names from your provided list)
    const breathingBones = ['Spine01', 'Spine02', 'Head', 'L_Clavicle', 'R_Clavicle', 'L_Upperarm', 'R_Upperarm']; 
    // console.log(`[IdleBreath] Creating clip with duration ${duration}s, intensity ${intensity}deg`);

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const stanceInfo = stancePoseTargets[boneName];
        const initial = initialPose[boneName];
        
        // Determine the base quaternion (must be the final stance pose)
        let baseQuat = new THREE.Quaternion();
        if (stanceInfo?.rotation && initial) {
            const eulerOrder = stanceInfo.eulerOrder;
            const r = stanceInfo.rotation;
            // We need the Euler angles in radians directly from the target definition
            const stanceEulerRad = new THREE.Euler(deg(r.x), deg(r.y), deg(r.z), eulerOrder);
            baseQuat.setFromEuler(stanceEulerRad);
        } else if (initial) {
            // If no specific stance defined for this bone, use its initial pose
            baseQuat.copy(initial.quat); 
        } else {
            // console.warn(`[IdleBreath] No initial or stance pose for bone: ${boneName}`);
            return; // Skip if no base pose info
        }

        // If this is a breathing bone, calculate peak rotation
        if (breathingBones.includes(boneName)) {
            const peakQuat = baseQuat.clone();
            const deltaEuler = new THREE.Euler();
            const deltaIntensityRad = deg(intensity);

            // Apply subtle rotations for "inhale" peak relative to stance pose
             if (boneName.includes('Spine')) {
                 deltaEuler.x = -deltaIntensityRad; // Slight pitch back
             } else if (boneName.includes('Clavicle')) {
                 deltaEuler.y = boneName.startsWith('L_') ? deltaIntensityRad * 0.5 : -deltaIntensityRad * 0.5; // Slight shrug/rotate up
             } else if (boneName.includes('Head')) {
                  deltaEuler.x = -deltaIntensityRad * 0.5; // Slight nod down during inhale?
             } else if (boneName.includes('Upperarm')) {
                 // Very subtle outward rotation
                 deltaEuler.z = boneName.startsWith('L_') ? -deltaIntensityRad * 0.3 : deltaIntensityRad * 0.3; 
             }
            
            // Create delta quaternion and apply it to the base (stance) quaternion
            const deltaQuat = new THREE.Quaternion().setFromEuler(deltaEuler);
            // Multiply base by delta to get the peak rotation
            peakQuat.multiplyQuaternions(baseQuat, deltaQuat);

            // Create track: Start(Stance) -> Peak(Stance+Delta) -> End(Stance)
            tracks.push(new THREE.QuaternionKeyframeTrack(
                `${boneName}.quaternion`, 
                times, 
                [
                    baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w, 
                    peakQuat.x, peakQuat.y, peakQuat.z, peakQuat.w, 
                    baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w
                ]
            ));
            // console.log(`[IdleBreath] Added breathing track for ${boneName}`);
        } else {
             // For non-breathing bones, keep them static at the stance pose
             // A track ensures they stay put during the breathing animation
            tracks.push(new THREE.QuaternionKeyframeTrack(
                 `${boneName}.quaternion`, 
                 [0], // Single keyframe is enough to hold pose
                 [baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w]
             ));
        }
    });

    if (tracks.length === 0) { console.warn(`[IdleBreath] No tracks generated for ${clipName}.`); return null; }
     // console.log(`[IdleBreath] Created clip ${clipName} with ${tracks.length} tracks.`);
    return new THREE.AnimationClip(clipName, duration, tracks);
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

    // --- Define Static Fight Stance Targets (Memoized) ---
     const fightStanceTargets = useMemo(() => ({
         // KEEPING THE VALUES FROM YOUR ROLLED-BACK CODE
         // Arms (Order: XYZ)
         'L_Upperarm': { rotation: { x: -6, y: -44, z: -76 }, eulerOrder: 'XYZ' as EulerOrder },
         'L_Forearm':  { rotation: { x: 102, y: -22, z: -34 }, eulerOrder: 'XYZ' as EulerOrder },
         'R_Upperarm': { rotation: { x: -51, y: 32, z: 107 }, eulerOrder: 'XYZ' as EulerOrder },
         'R_Forearm':  { rotation: { x: 51, y: 13, z: 72 }, eulerOrder: 'XYZ' as EulerOrder },
         // Legs (Order: YXZ)
         'L_Thigh':    { rotation: { x: 2, y: 180, z: -173 }, eulerOrder: 'YXZ' as EulerOrder },
         'L_Calf':     { rotation: { x: -6, y: 11, z: -9 }, eulerOrder: 'YXZ' as EulerOrder },
         'R_Thigh':    { rotation: { x: 30, y: 166, z: 167 }, eulerOrder: 'YXZ' as EulerOrder },
         'R_Calf':     { rotation: { x: 5, y: -21, z: -2 }, eulerOrder: 'YXZ' as EulerOrder },
     }), []);
     // -----------------------------------------------------------

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