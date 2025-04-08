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

interface CharacterViewerProps {
    modelUrl: string;
}

// --- Animation Clip Creation (Restored) ---
// Modify bone names and rotations based on console logs and desired pose
function createFightStanceClip(skeleton: THREE.Skeleton | null, initialPose: Record<string, any>, boneTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }>, duration: number = 0.5): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0) return null;

    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration];
    const deg = THREE.MathUtils.degToRad;

    console.log("--- Creating Fight Stance Clip ---");

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const target = boneTargets[boneName];
        const initial = initialPose[boneName];

        if (!initial) {
             console.warn(`No initial pose data for bone: ${boneName}`);
             return;
        }

        const startQuat: THREE.Quaternion = initial.quat;
        let endQuat = startQuat.clone();

        if (target?.rotation) {
            const eulerOrder = target.eulerOrder || 'XYZ';
            const targetEulerDeg = target.rotation;
            const initialEuler = new THREE.Euler().setFromQuaternion(startQuat, eulerOrder);
            const endEulerRad = new THREE.Euler(
                deg(targetEulerDeg.x ?? THREE.MathUtils.radToDeg(initialEuler.x)),
                deg(targetEulerDeg.y ?? THREE.MathUtils.radToDeg(initialEuler.y)),
                deg(targetEulerDeg.z ?? THREE.MathUtils.radToDeg(initialEuler.z)),
                eulerOrder
            );
            endQuat.setFromEuler(endEulerRad);
            console.log(`  ${boneName}: Target Euler(${eulerOrder}) = x: ${targetEulerDeg.x?.toFixed(1) ?? 'init'}, y: ${targetEulerDeg.y?.toFixed(1) ?? 'init'}, z: ${targetEulerDeg.z?.toFixed(1) ?? 'init'}`);
        }

        if (target || !endQuat.equals(startQuat)) {
            tracks.push(new THREE.QuaternionKeyframeTrack(
                `${boneName}.quaternion`,
                times,
                [startQuat.x, startQuat.y, startQuat.z, startQuat.w, endQuat.x, endQuat.y, endQuat.z, endQuat.w]
            ));
        }
    });
    console.log("----------------------------------");
    if (tracks.length === 0) {
        console.warn("No tracks generated for fight stance clip.");
        return null;
    }
    return new THREE.AnimationClip('FightStance', duration, tracks);
}

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

export default function CharacterViewer({ modelUrl }: CharacterViewerProps) {
    const [autoRotate, setAutoRotate] = useState(true);
    const [mixer, setMixer] = useState<THREE.AnimationMixer | null>(null);
    const [initialPose, setInitialPose] = useState<Record<string, InitialPoseData>>({});
    const [skeleton, setSkeleton] = useState<THREE.Skeleton | null>(null);

    // Restore state for animation actions and playback
    const [fightStanceAction, setFightStanceAction] = useState<THREE.AnimationAction | null>(null);
    const [resetPoseAction, setResetPoseAction] = useState<THREE.AnimationAction | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    // Log state changes for verification
    useEffect(() => {
        console.log("[Viewer] Mixer updated:", !!mixer);
    }, [mixer]);

    useEffect(() => {
        console.log("[Viewer] Skeleton updated:", !!skeleton);
    }, [skeleton]);

    useEffect(() => {
        console.log("[Viewer] Initial Pose updated:", Object.keys(initialPose).length, "bones");
    }, [initialPose]);

    // Restore Effect to create actions
    useEffect(() => {
        // Ensure all dependencies are met
        if (mixer && skeleton && Object.keys(initialPose).length > 0) {
            console.log("[Viewer] Creating animation actions...");
            // --- DEFINE BONE TARGETS HERE ---
            // Adjust bone names based on console logs!
            const fightStanceTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }> = {
                // ISOLATION TEST 5: Left Leg Stance (XYZ Order, Z-axis rotation)
                'L_Thigh': { rotation: { z: -30 }, eulerOrder: 'XYZ' }, 
                'L_Calf': { rotation: { z: 45 }, eulerOrder: 'XYZ' },  
                /*
                'L_Upperarm': { rotation: { y: -30 }, eulerOrder: 'XYZ' }, 
                'L_Forearm': { rotation: { z: -90 }, eulerOrder: 'XYZ' }, 
                'R_Upperarm': { rotation: { y: -30 }, eulerOrder: 'XYZ' },
                'R_Forearm': { rotation: { z: 90 }, eulerOrder: 'XYZ' }, 

                // Legs: Keep previous settings (YXZ order)
                // 'L_Thigh': { rotation: { x: -30, y: -10 }, eulerOrder: 'YXZ' },
                // 'L_Calf': { rotation: { x: 45 }, eulerOrder: 'YXZ' },  
                'R_Thigh': { rotation: { x: 20 }, eulerOrder: 'YXZ' },  
                'R_Calf': { rotation: { x: 30 }, eulerOrder: 'YXZ' },  
                */
            };

            const stanceClip = createFightStanceClip(skeleton, initialPose, fightStanceTargets);
            if (stanceClip) {
                const action = mixer.clipAction(stanceClip);
                action.setLoop(THREE.LoopOnce); action.clampWhenFinished = true;
                setFightStanceAction(action);
                 console.log("[Viewer] Fight Stance Action created.");
            } else {
                 console.error("[Viewer] Failed to create Fight Stance Clip/Action.");
                 setFightStanceAction(null);
            }

             const resetClip = createResetPoseClip(skeleton, initialPose);
             if (resetClip) {
                 const action = mixer.clipAction(resetClip);
                 action.setLoop(THREE.LoopOnce); action.clampWhenFinished = true;
                 setResetPoseAction(action);
                 console.log("[Viewer] Reset Pose Action created.");
             } else {
                 console.error("[Viewer] Failed to create Reset Pose Clip/Action.");
                 setResetPoseAction(null);
             }
        } else {
            // Clear actions if dependencies are missing
             if (fightStanceAction) fightStanceAction.stop();
             if (resetPoseAction) resetPoseAction.stop();
            setFightStanceAction(null);
            setResetPoseAction(null);
        }

        // Cleanup actions on unmount/dependency change
        return () => {
             if (fightStanceAction) fightStanceAction.stop();
             if (resetPoseAction) resetPoseAction.stop();
             setFightStanceAction(null);
             setResetPoseAction(null);
        };

    }, [mixer, skeleton, initialPose]); // Dependencies for creating actions

    // Restore Animation sequence handler
    const playFightStanceSequence = useCallback(() => {
        if (!fightStanceAction || !resetPoseAction || !mixer || isPlaying) {
             console.warn("Cannot play sequence. Missing actions/mixer or already playing.");
             return;
        }

        setIsPlaying(true);
        setAutoRotate(false);
        mixer.stopAllAction();

        // Define listener with specific event type
        const onStanceFinished = (event: AnimationFinishedEvent) => {
            // Check if the finished action is the correct one
            if (event.action === fightStanceAction) {
                console.log("[Viewer] Stance finished. Waiting...");
                mixer.removeEventListener('finished', onStanceFinished);
                setTimeout(() => {
                    console.log("[Viewer] Playing reset pose...");
                    resetPoseAction.reset().play();
                    // Explicitly cast listener to bypass type check
                    mixer.addEventListener('finished', onResetFinished as any);
                }, 1500); // Hold stance for 1.5 seconds
            }
        };

        // Define listener with specific event type
        const onResetFinished = (event: AnimationFinishedEvent) => {
            // Check if the finished action is the correct one
            if (event.action === resetPoseAction) {
                console.log("[Viewer] Reset finished.");
                mixer.removeEventListener('finished', onResetFinished);
                setIsPlaying(false);
                // setAutoRotate(true);
            }
        };

        console.log("[Viewer] Playing fight stance...");
        fightStanceAction.reset().play();
        // Explicitly cast listener to bypass type check
        mixer.addEventListener('finished', onStanceFinished as any);

    }, [fightStanceAction, resetPoseAction, mixer, setAutoRotate, isPlaying]);

    return (
        <div className="relative w-full h-screen bg-gradient-to-br from-arcade-dark-gray to-arcade-bg">
            {/* Restore Button Overlay */}
            <div className="absolute top-24 left-4 z-10">
                <button
                    onClick={playFightStanceSequence}
                    disabled={!fightStanceAction || !resetPoseAction || isPlaying}
                    className={`btn-arcade ${(!fightStanceAction || !resetPoseAction || isPlaying) ? "btn-arcade-disabled" : "btn-arcade-action"}`}
                >
                    {isPlaying ? "Animating..." : (skeleton ? "Fight Stance" : "Loading...")}
                </button>
            </div>

            <Canvas
                camera={{ position: [0, 0.5, 1.8], fov: 60 }}
                shadows
            >
                {/* Basic lighting */}
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
                    {/* Pass ALL setters down to Model */}
                    <Model 
                        url={modelUrl} 
                        setAutoRotate={setAutoRotate} 
                        setMixer={setMixer} 
                        setInitialPose={setInitialPose} 
                        setSkeleton={setSkeleton} 
                    />
                    {/* Add the AnimationRunner inside Canvas */}
                    <AnimationRunner mixer={mixer} />
                </Suspense>

                <OrbitControls
                    enablePan={true}
                    enableZoom={true}
                    enableRotate={true}
                    autoRotate={autoRotate}
                    autoRotateSpeed={1.5}
                    target={[0, 0.5, 0]}
                    onChange={() => { if (autoRotate) setAutoRotate(false); }}
                />
            </Canvas>
        </div>
    );
} 