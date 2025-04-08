'use client';

// -------- Server Component for Data Fetching --------
import { supabase } from '@/lib/supabase/client';
import { notFound, useParams } from 'next/navigation';

// Re-import React for Client Component
import React, { Suspense, useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useControls, folder, Leva } from 'leva';

// -------- Types (Used by both Server potentially and Client) --------

interface CharacterEditorPageProps {
    params: {
        characterId: string;
    }
}

type EulerOrder = 'XYZ' | 'YZX' | 'ZXY' | 'XZY' | 'YXZ' | 'ZYX';

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

interface AnimationRunnerProps {
    mixer: THREE.AnimationMixer | null;
}

// -------- Server Component Implementation --------

// Opt out of caching
export const dynamic = 'force-dynamic';

export default function CharacterPoseEditor() {
    // --- State Variables ---
    const [modelUrl, setModelUrl] = useState<string | null>(null);
    const [characterName, setCharacterName] = useState<string | null>(null);
    const [status, setStatus] = useState<string>('loading'); // loading, ready, error, missing_url
    const [autoRotate, setAutoRotate] = useState(true);
    const [mixer, setMixer] = useState<THREE.AnimationMixer | null>(null);
    const [initialPose, setInitialPose] = useState<Record<string, InitialPoseData>>({});
    const [skeleton, setSkeleton] = useState<THREE.Skeleton | null>(null);
    const [resetPoseAction, setResetPoseAction] = useState<THREE.AnimationAction | null>(null);
    const [levaInitialized, setLevaInitialized] = useState(false);
    
    // Get characterId from URL params
    const params = useParams();
    const characterId = params.characterId as string;

    // --- Data Fetching Effect ---
    useEffect(() => {
        if (!characterId) return;

        setStatus('loading');
        console.log(`[Editor] Fetching character data for ID: ${characterId}`);

        const fetchCharacter = async () => {
            const { data: characterData, error } = await supabase
                .from('characters')
                .select('id, name, model_glb_url, status')
                .eq('id', characterId)
                .single();

            if (error || !characterData) {
                console.error(`[Editor] Error fetching character ${characterId}:`, error);
                setStatus('error');
                return; 
            }

            setCharacterName(characterData.name || 'Unnamed Fighter');

            let finalModelUrl = characterData.model_glb_url;
            if (finalModelUrl && !finalModelUrl.startsWith('http') && process.env.NEXT_PUBLIC_R2_PUBLIC_URL) {
                finalModelUrl = `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${finalModelUrl}`;
            }

            if (!finalModelUrl) {
                console.error(`[Editor] Model URL is missing for character ${characterId}.`);
                setStatus('missing_url');
            } else {
                setModelUrl(finalModelUrl);
                setStatus('ready');
            }
        };

        fetchCharacter();

    }, [characterId]); // Re-fetch if characterId changes

    // --- Leva Controls (Keep definition) ---
    const [levaControls, setLevaControls] = useControls('Fight Stance Pose', () => ({
        Arms: folder({
            ArmEulerOrder: { value: 'XYZ' as EulerOrder, options: ['XYZ', 'YXZ', 'ZYX'] },
            'L_Upperarm x': { value: 0, min: -180, max: 180, step: 1 }, 
            'L_Upperarm y': { value: 0, min: -180, max: 180, step: 1 },
            'L_Upperarm z': { value: 0, min: -180, max: 180, step: 1 },
            'L_Forearm x': { value: 0, min: -180, max: 180, step: 1 },
            'L_Forearm y': { value: 0, min: -180, max: 180, step: 1 },
            'L_Forearm z': { value: 0, min: -180, max: 180, step: 1 }, 
            'R_Upperarm x': { value: 0, min: -180, max: 180, step: 1 },
            'R_Upperarm y': { value: 0, min: -180, max: 180, step: 1 },
            'R_Upperarm z': { value: 0, min: -180, max: 180, step: 1 },
            'R_Forearm x': { value: 0, min: -180, max: 180, step: 1 },
            'R_Forearm y': { value: 0, min: -180, max: 180, step: 1 },
            'R_Forearm z': { value: 0, min: -180, max: 180, step: 1 },
        }),
        Legs: folder({
            LegEulerOrder: { value: 'XYZ' as EulerOrder, options: ['XYZ', 'YXZ', 'ZYX'] },
            'L_Thigh x': { value: 0, min: -180, max: 180, step: 1 },
            'L_Thigh y': { value: 0, min: -180, max: 180, step: 1 },
            'L_Thigh z': { value: 0, min: -180, max: 180, step: 1 },
            'L_Calf x': { value: 0, min: -180, max: 180, step: 1 },
            'L_Calf y': { value: 0, min: -180, max: 180, step: 1 },
            'L_Calf z': { value: 0, min: -180, max: 180, step: 1 },
            'R_Thigh x': { value: 0, min: -180, max: 180, step: 1 },
            'R_Thigh y': { value: 0, min: -180, max: 180, step: 1 },
            'R_Thigh z': { value: 0, min: -180, max: 180, step: 1 },
            'R_Calf x': { value: 0, min: -180, max: 180, step: 1 },
            'R_Calf y': { value: 0, min: -180, max: 180, step: 1 },
            'R_Calf z': { value: 0, min: -180, max: 180, step: 1 },
        }),
    }), [initialPose]);
    
    // --- Initialize Leva Controls (Keep definition) ---
    useEffect(() => {
        if (!levaInitialized && skeleton && Object.keys(initialPose).length > 0) {
            console.log("[Editor] Initializing Leva controls...");
            const initialEuler = new THREE.Euler();
            const rad = THREE.MathUtils.radToDeg;
            const updates: Record<string, number> = {};
            const updateFromBone = (boneName: string, controlPrefix: string, eulerOrder: EulerOrder) => {
                const initial = initialPose[boneName];
                if (initial) {
                    initialEuler.setFromQuaternion(initial.quat, eulerOrder);
                    updates[`${controlPrefix} x`] = rad(initialEuler.x);
                    updates[`${controlPrefix} y`] = rad(initialEuler.y);
                    updates[`${controlPrefix} z`] = rad(initialEuler.z);
                } else { console.warn(`Initial pose data missing for bone: ${boneName}`); }
            };
            const initialArmOrder = 'XYZ' as EulerOrder; const initialLegOrder = 'YXZ' as EulerOrder;
            updateFromBone('L_Upperarm', 'L_Upperarm', initialArmOrder);
            updateFromBone('L_Forearm', 'L_Forearm', initialArmOrder);
            updateFromBone('R_Upperarm', 'R_Upperarm', initialArmOrder);
            updateFromBone('R_Forearm', 'R_Forearm', initialArmOrder);
            updateFromBone('L_Thigh', 'L_Thigh', initialLegOrder);
            updateFromBone('L_Calf', 'L_Calf', initialLegOrder);
            updateFromBone('R_Thigh', 'R_Thigh', initialLegOrder);
            updateFromBone('R_Calf', 'R_Calf', initialLegOrder);
            setLevaControls({ ArmEulerOrder: initialArmOrder, LegEulerOrder: initialLegOrder, ...updates });
            setLevaInitialized(true);
            console.log("[Editor] Leva controls initialized.");
        }
    }, [initialPose, skeleton, levaInitialized, setLevaControls]);
    
    // --- Log state changes (Keep, update log prefix) ---
    useEffect(() => { console.log("[Editor] Mixer updated:", !!mixer); }, [mixer]);
    useEffect(() => { console.log("[Editor] Skeleton updated:", !!skeleton); }, [skeleton]);
    useEffect(() => { console.log("[Editor] Initial Pose updated:", Object.keys(initialPose).length, "bones"); }, [initialPose]);
    
    // --- Create Reset Action (Keep definition) ---
    useEffect(() => {
        if (mixer && skeleton && Object.keys(initialPose).length > 0) {
             if (!resetPoseAction) {
                 const resetClip = createResetPoseClip(skeleton, initialPose);
                 if (resetClip) {
                     const action = mixer.clipAction(resetClip);
                     // @ts-ignore
                     action.setLoop(THREE.LoopOnce); action.clampWhenFinished = true;
                     setResetPoseAction(action);
                     console.log("[Editor] Reset Pose Action created.");
                 } else { console.error("[Editor] Failed to create Reset Pose Clip/Action."); }
             }
        } else { if (resetPoseAction) resetPoseAction.stop(); setResetPoseAction(null); }
        return () => { if (resetPoseAction) resetPoseAction.stop(); setResetPoseAction(null); };
    }, [mixer, skeleton, initialPose]);
    
    // --- Live Update Pose (Keep definition) ---
    useEffect(() => {
        if (!skeleton || Object.keys(initialPose).length === 0 || !levaInitialized) return; 
        console.log("[Editor] Applying static pose due to control change...");
        const controls = levaControls as any; 
        mixer?.stopAllAction(); 
        setAutoRotate(false); 
        const targetQuaternion = new THREE.Quaternion();
        const targetEuler = new THREE.Euler();
        const deg = THREE.MathUtils.degToRad;
        const currentTargets: Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }> = {
            'L_Upperarm': { rotation: { x: controls['L_Upperarm x'], y: controls['L_Upperarm y'], z: controls['L_Upperarm z'] }, eulerOrder: controls.ArmEulerOrder as EulerOrder },
            'L_Forearm': { rotation: { x: controls['L_Forearm x'], y: controls['L_Forearm y'], z: controls['L_Forearm z'] }, eulerOrder: controls.ArmEulerOrder as EulerOrder },
            'R_Upperarm': { rotation: { x: controls['R_Upperarm x'], y: controls['R_Upperarm y'], z: controls['R_Upperarm z'] }, eulerOrder: controls.ArmEulerOrder as EulerOrder },
            'R_Forearm': { rotation: { x: controls['R_Forearm x'], y: controls['R_Forearm y'], z: controls['R_Forearm z'] }, eulerOrder: controls.ArmEulerOrder as EulerOrder },
            'L_Thigh': { rotation: { x: controls['L_Thigh x'], y: controls['L_Thigh y'], z: controls['L_Thigh z'] }, eulerOrder: controls.LegEulerOrder as EulerOrder },
            'L_Calf': { rotation: { x: controls['L_Calf x'], y: controls['L_Calf y'], z: controls['L_Calf z'] }, eulerOrder: controls.LegEulerOrder as EulerOrder },
            'R_Thigh': { rotation: { x: controls['R_Thigh x'], y: controls['R_Thigh y'], z: controls['R_Thigh z'] }, eulerOrder: controls.LegEulerOrder as EulerOrder },
            'R_Calf': { rotation: { x: controls['R_Calf x'], y: controls['R_Calf y'], z: controls['R_Calf z'] }, eulerOrder: controls.LegEulerOrder as EulerOrder },
        };
        skeleton.bones.forEach(bone => {
            const boneName = bone.name;
            const targetInfo = currentTargets[boneName];
            const initial = initialPose[boneName];
            if (!initial) return;
            if (targetInfo?.rotation) {
                const eulerOrder = targetInfo.eulerOrder || 'XYZ';
                const r = targetInfo.rotation;
                targetEuler.set(deg(r.x ?? 0), deg(r.y ?? 0), deg(r.z ?? 0), eulerOrder);
                targetQuaternion.setFromEuler(targetEuler);
                bone.quaternion.copy(targetQuaternion);
            } else {
                bone.quaternion.copy(initial.quat);
            }
        });
    }, [levaControls, skeleton, initialPose, mixer, setAutoRotate, levaInitialized]);
    
    // --- Reset Pose Handler (Keep definition) ---
    const triggerResetPose = useCallback(() => {
        if (!resetPoseAction || !mixer) return;
        console.log("[Editor] Playing reset pose...");
        mixer.stopAllAction();
        setAutoRotate(false);
        resetPoseAction.reset().play();
    }, [resetPoseAction, mixer, setAutoRotate]);

    // --- Conditional Rendering based on Status ---
    if (status === 'loading') {
        return <main className="flex min-h-screen flex-col items-center justify-center"><p className="text-arcade-yellow text-xl">Loading Editor...</p></main>;
    }
    if (status === 'error') {
        // Optionally use Next.js notFound() here too, but this gives a specific message
        return <main className="flex min-h-screen flex-col items-center justify-center"><p className="text-arcade-red text-xl">Error loading character data.</p></main>;
    }
     if (status === 'missing_url' || !modelUrl) {
         return (
             <main className="flex min-h-screen flex-col items-center justify-center p-8">
                <h1 className="text-4xl font-bold text-arcade-white mb-4">{characterName || 'Character'}</h1>
                <p className="text-2xl text-arcade-red">Model URL is missing.</p>
            </main>
        );
    }

    // --- Main Render (If Ready) ---
    return (
        <> 
            <Leva collapsed={false} />
             {/* Main div needs h-screen or similar to contain Canvas */}
            <div className="relative w-full h-screen bg-gradient-to-br from-arcade-dark-gray to-arcade-bg">
                 <div className="absolute top-4 left-4 z-10 bg-black/50 p-2 rounded">
                     <h1 className="text-2xl sm:text-3xl font-bold text-logo-yellow drop-shadow-[2px_2px_0_rgba(0,0,0,0.8)]">
                        Pose Editor: {characterName}
                    </h1>
                 </div>
                <div className="absolute top-24 left-4 z-10 flex flex-col gap-2">
                    <button onClick={triggerResetPose} disabled={!resetPoseAction} className={`btn-arcade ${!resetPoseAction ? "btn-arcade-disabled" : "btn-arcade-primary"}`}>
                        Reset Pose
                    </button>
                </div>
                <Canvas camera={{ position: [0, 0.5, 1.8], fov: 60 }} shadows >
                    <ambientLight intensity={0.7} />
                    <directionalLight position={[5, 10, 5]} intensity={1.0} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
                    <hemisphereLight intensity={0.4} groundColor="#555" />
                    <Suspense fallback={ <Html center> <p className="text-arcade-yellow text-xl animate-pulse">Loading Model...</p> </Html> }>
                        <Model url={modelUrl} setAutoRotate={setAutoRotate} setMixer={setMixer} setInitialPose={setInitialPose} setSkeleton={setSkeleton} />
                        <AnimationRunner mixer={mixer} />
                    </Suspense>
                    <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} autoRotate={autoRotate} autoRotateSpeed={1.5} target={[0, 0.5, 0]} onChange={() => { if (autoRotate) setAutoRotate(false); }} />
                </Canvas>
            </div>
        </>
    );
}

// -------- Client Component with Viewer/Editor Logic --------

// --- Model Component (Copied from CharacterViewer.tsx) ---
function Model({ url, setAutoRotate, setMixer, setInitialPose, setSkeleton }: ModelProps) {
    const { scene, animations } = useGLTF(url);
    const modelRef = useRef<THREE.Group>(null!); 
    useEffect(() => {
        if (scene) {
            scene.rotation.y = -Math.PI / 2;
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
                console.log("[Model] Available Bones:");
                // @ts-ignore 
                foundSkeleton.bones.forEach((bone: THREE.Bone) => {
                    console.log(`- ${bone.name}`);
                    pose[bone.name] = { pos: bone.position.clone(), quat: bone.quaternion.clone(), scale: bone.scale.clone() };
                });
                console.log("-----------------------------");
            } else {
                console.warn("[Model] Could not find skeleton.");
            }
            setSkeleton(foundSkeleton);
            setInitialPose(pose);
        }
        return () => { setMixer(null); setInitialPose({}); setSkeleton(null); };
    }, [scene, setMixer, setInitialPose, setSkeleton, animations]);
    const handleInteraction = useCallback(() => { if (setAutoRotate) setAutoRotate(false); }, [setAutoRotate]);
    const pointerEvents = useMemo(() => ({ onPointerDown: handleInteraction, onWheel: handleInteraction }), [handleInteraction]);
    return <primitive object={scene} ref={modelRef} {...pointerEvents} />;
}

// --- AnimationRunner Component (Copied from CharacterViewer.tsx) ---
function AnimationRunner({ mixer }: AnimationRunnerProps) {
    useFrame((_, delta) => { mixer?.update(delta); });
    return null;
}

// --- createResetPoseClip Function (Copied from CharacterViewer.tsx) ---
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