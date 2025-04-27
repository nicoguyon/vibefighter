'use client';

// -------- Server Component for Data Fetching --------
import { supabase } from '@/lib/supabase/client';
import { notFound, useParams } from 'next/navigation';
import { 
    createFightStanceClip, 
    createResetPoseClip, 
    createIdleBreathClip,
    createWalkCycleClip,
    createRightPunchClip,
    createBlockPoseClip,
    createDuckPoseClip,
    createDuckKickClip,
    createTransitionToHelloClip,
    createHelloWaveLoopClip,
    createTransitionToArmsCrossedClip,
    createArmsCrossedBreathClip,
    createBowClip,
    createLeftPunchClip, // <-- ADDED IMPORT
    createFallBackwardClip, // <-- ADDED IMPORT
    defaultFightStanceTargets,
    blockTargets,
    duckTargets,
    helloTargets,
    armsCrossedTargets,
    bowArmTargets,
    StartPose // <-- ADDED IMPORT
} from '@/lib/animations/clips';

// Re-import React for Client Component
import React, { Suspense, useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, Html } from '@react-three/drei'; // Re-add Environment import
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

// Define possible pose states
type PoseState = 'initial' | 'stance' | 'blocking' | 'ducking' | 'walking' | 'transitioning' | 'punching' | 'kicking' | 'waving' | 'armsCrossed' | 'bowing' | 'falling' | 'fallen'; // <-- ADDED FALLING STATES

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
    const [fightStanceAction, setFightStanceAction] = useState<THREE.AnimationAction | null>(null);
    const [idleBreathAction, setIdleBreathAction] = useState<THREE.AnimationAction | null>(null);
    const [walkCycleAction, setWalkCycleAction] = useState<THREE.AnimationAction | null>(null);
    const [rightPunchAction, setRightPunchAction] = useState<THREE.AnimationAction | null>(null);
    const [blockPoseAction, setBlockPoseAction] = useState<THREE.AnimationAction | null>(null);
    const [duckPoseAction, setDuckPoseAction] = useState<THREE.AnimationAction | null>(null);
    const [duckKickAction, setDuckKickAction] = useState<THREE.AnimationAction | null>(null);
    const [transitionToHelloAction, setTransitionToHelloAction] = useState<THREE.AnimationAction | null>(null);
    const [helloWaveLoopAction, setHelloWaveLoopAction] = useState<THREE.AnimationAction | null>(null);
    const [transitionToArmsCrossedAction, setTransitionToArmsCrossedAction] = useState<THREE.AnimationAction | null>(null);
    const [armsCrossedBreathAction, setArmsCrossedBreathAction] = useState<THREE.AnimationAction | null>(null);
    const [bowAction, setBowAction] = useState<THREE.AnimationAction | null>(null);
    const [leftPunchAction, setLeftPunchAction] = useState<THREE.AnimationAction | null>(null); // <-- ADDED STATE
    const [fallBackwardAction, setFallBackwardAction] = useState<THREE.AnimationAction | null>(null); // <-- ADDED STATE
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentPoseState, setCurrentPoseState] = useState<PoseState>('initial');
    const [capturedStancePose, setCapturedStancePose] = useState<StartPose | null>(null); // <-- ADDED STATE
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
            'L_Hand x': { value: 0, min: -180, max: 180, step: 1 },
            'L_Hand y': { value: 0, min: -180, max: 180, step: 1 },
            'L_Hand z': { value: 0, min: -180, max: 180, step: 1 },
            'R_Upperarm x': { value: 0, min: -180, max: 180, step: 1 },
            'R_Upperarm y': { value: 0, min: -180, max: 180, step: 1 },
            'R_Upperarm z': { value: 0, min: -180, max: 180, step: 1 },
            'R_Forearm x': { value: 0, min: -180, max: 180, step: 1 },
            'R_Forearm y': { value: 0, min: -180, max: 180, step: 1 },
            'R_Forearm z': { value: 0, min: -180, max: 180, step: 1 },
            'R_Hand x': { value: 0, min: -180, max: 180, step: 1 },
            'R_Hand y': { value: 0, min: -180, max: 180, step: 1 },
            'R_Hand z': { value: 0, min: -180, max: 180, step: 1 },
        }),
        Shoulders: folder({
            ShoulderEulerOrder: { value: 'XYZ' as EulerOrder, options: ['XYZ', 'YXZ', 'ZYX'] },
            'L_Clavicle x': { value: 0, min: -180, max: 180, step: 1 },
            'L_Clavicle y': { value: 0, min: -180, max: 180, step: 1 },
            'L_Clavicle z': { value: 0, min: -180, max: 180, step: 1 },
            'R_Clavicle x': { value: 0, min: -180, max: 180, step: 1 },
            'R_Clavicle y': { value: 0, min: -180, max: 180, step: 1 },
            'R_Clavicle z': { value: 0, min: -180, max: 180, step: 1 },
        }),
        Legs: folder({
            LegEulerOrder: { value: 'YXZ' as EulerOrder, options: ['XYZ', 'YXZ', 'ZYX'] }, // Default YXZ often better for legs
            'L_Thigh x': { value: 0, min: -180, max: 180, step: 1 },
            'L_Thigh y': { value: 0, min: -180, max: 180, step: 1 },
            'L_Thigh z': { value: 0, min: -180, max: 180, step: 1 },
            'L_Calf x': { value: 0, min: -180, max: 180, step: 1 },
            'L_Calf y': { value: 0, min: -180, max: 180, step: 1 },
            'L_Calf z': { value: 0, min: -180, max: 180, step: 1 },
            'L_Foot x': { value: 0, min: -180, max: 180, step: 1 },
            'L_Foot y': { value: 0, min: -180, max: 180, step: 1 },
            'L_Foot z': { value: 0, min: -180, max: 180, step: 1 },
            'R_Thigh x': { value: 0, min: -180, max: 180, step: 1 },
            'R_Thigh y': { value: 0, min: -180, max: 180, step: 1 },
            'R_Thigh z': { value: 0, min: -180, max: 180, step: 1 },
            'R_Calf x': { value: 0, min: -180, max: 180, step: 1 },
            'R_Calf y': { value: 0, min: -180, max: 180, step: 1 },
            'R_Calf z': { value: 0, min: -180, max: 180, step: 1 },
            'R_Foot x': { value: 0, min: -180, max: 180, step: 1 },
            'R_Foot y': { value: 0, min: -180, max: 180, step: 1 },
            'R_Foot z': { value: 0, min: -180, max: 180, step: 1 },
        }),
        Torso: folder({
             TorsoEulerOrder: { value: 'XYZ' as EulerOrder, options: ['XYZ', 'YXZ', 'ZYX'] },
             'Hip x': { value: 0, min: -180, max: 180, step: 1 }, // Note: Hip often root, might not be useful to rotate directly
             'Hip y': { value: 0, min: -180, max: 180, step: 1 },
             'Hip z': { value: 0, min: -180, max: 180, step: 1 },
             'Pelvis x': { value: 0, min: -180, max: 180, step: 1 }, 
             'Pelvis y': { value: 0, min: -180, max: 180, step: 1 },
             'Pelvis z': { value: 0, min: -180, max: 180, step: 1 },
             'Waist x': { value: 0, min: -180, max: 180, step: 1 },
             'Waist y': { value: 0, min: -180, max: 180, step: 1 },
             'Waist z': { value: 0, min: -180, max: 180, step: 1 },
             'Spine01 x': { value: 0, min: -180, max: 180, step: 1 },
             'Spine01 y': { value: 0, min: -180, max: 180, step: 1 },
             'Spine01 z': { value: 0, min: -180, max: 180, step: 1 },
             'Spine02 x': { value: 0, min: -180, max: 180, step: 1 },
             'Spine02 y': { value: 0, min: -180, max: 180, step: 1 },
             'Spine02 z': { value: 0, min: -180, max: 180, step: 1 },
        }),
        HeadNeck: folder({
            HeadNeckEulerOrder: { value: 'XYZ' as EulerOrder, options: ['XYZ', 'YXZ', 'ZYX'] },
            'NeckTwist01 x': { value: 0, min: -180, max: 180, step: 1 },
            'NeckTwist01 y': { value: 0, min: -180, max: 180, step: 1 },
            'NeckTwist01 z': { value: 0, min: -180, max: 180, step: 1 },
            'NeckTwist02 x': { value: 0, min: -180, max: 180, step: 1 },
            'NeckTwist02 y': { value: 0, min: -180, max: 180, step: 1 },
            'NeckTwist02 z': { value: 0, min: -180, max: 180, step: 1 },
            'Head x': { value: 0, min: -180, max: 180, step: 1 },
            'Head y': { value: 0, min: -180, max: 180, step: 1 },
            'Head z': { value: 0, min: -180, max: 180, step: 1 },
        }),
    }), [initialPose]);
    
    // --- Initialize Leva Controls (Keep definition) ---
    useEffect(() => {
        if (!levaInitialized && skeleton && Object.keys(initialPose).length > 0) {
            console.log("[Editor] Initializing Leva controls...");
            const initialEuler = new THREE.Euler();
            const rad = THREE.MathUtils.radToDeg;
            const updates: Record<string, number | string> = {}; // Allow string for EulerOrder updates
            const updateFromBone = (boneName: string, controlPrefix: string, eulerOrder: EulerOrder) => {
                const initial = initialPose[boneName];
                if (initial) {
                    initialEuler.setFromQuaternion(initial.quat, eulerOrder);
                    updates[`${controlPrefix} x`] = rad(initialEuler.x);
                    updates[`${controlPrefix} y`] = rad(initialEuler.y);
                    updates[`${controlPrefix} z`] = rad(initialEuler.z);
                } else { console.warn(`Initial pose data missing for bone: ${boneName}`); }
            };
            
            // Define default Euler orders for initialization (match useControls)
            const initialArmOrder = 'XYZ' as EulerOrder;
            const initialShoulderOrder = 'XYZ' as EulerOrder;
            const initialLegOrder = 'YXZ' as EulerOrder;
            const initialTorsoOrder = 'XYZ' as EulerOrder;
            const initialHeadNeckOrder = 'XYZ' as EulerOrder;

            // Update ALL bones from initial pose
            updateFromBone('L_Upperarm', 'L_Upperarm', initialArmOrder);
            updateFromBone('L_Forearm', 'L_Forearm', initialArmOrder);
            updateFromBone('L_Hand', 'L_Hand', initialArmOrder);
            updateFromBone('R_Upperarm', 'R_Upperarm', initialArmOrder);
            updateFromBone('R_Forearm', 'R_Forearm', initialArmOrder);
            updateFromBone('R_Hand', 'R_Hand', initialArmOrder);
            
            updateFromBone('L_Clavicle', 'L_Clavicle', initialShoulderOrder);
            updateFromBone('R_Clavicle', 'R_Clavicle', initialShoulderOrder);

            updateFromBone('L_Thigh', 'L_Thigh', initialLegOrder);
            updateFromBone('L_Calf', 'L_Calf', initialLegOrder);
            updateFromBone('L_Foot', 'L_Foot', initialLegOrder);
            updateFromBone('R_Thigh', 'R_Thigh', initialLegOrder);
            updateFromBone('R_Calf', 'R_Calf', initialLegOrder);
            updateFromBone('R_Foot', 'R_Foot', initialLegOrder);

            updateFromBone('Hip', 'Hip', initialTorsoOrder);
            updateFromBone('Pelvis', 'Pelvis', initialTorsoOrder);
            updateFromBone('Waist', 'Waist', initialTorsoOrder);
            updateFromBone('Spine01', 'Spine01', initialTorsoOrder);
            updateFromBone('Spine02', 'Spine02', initialTorsoOrder);

            updateFromBone('NeckTwist01', 'NeckTwist01', initialHeadNeckOrder);
            updateFromBone('NeckTwist02', 'NeckTwist02', initialHeadNeckOrder);
            updateFromBone('Head', 'Head', initialHeadNeckOrder);

            // Set initial Euler orders in Leva
            updates['ArmEulerOrder'] = initialArmOrder;
            updates['ShoulderEulerOrder'] = initialShoulderOrder;
            updates['LegEulerOrder'] = initialLegOrder;
            updates['TorsoEulerOrder'] = initialTorsoOrder;
            updates['HeadNeckEulerOrder'] = initialHeadNeckOrder;
            
            // Apply ALL updates from initial pose
            setLevaControls(updates);
            setLevaInitialized(true);
            console.log("[Editor] Leva controls initialized.");
        }
    }, [initialPose, skeleton, levaInitialized, setLevaControls]);
    
    // --- Log state changes (Keep, update log prefix) ---
    useEffect(() => { console.log("[Editor] Mixer updated:", !!mixer); }, [mixer]);
    useEffect(() => { console.log("[Editor] Skeleton updated:", !!skeleton); }, [skeleton]);
    useEffect(() => { console.log("[Editor] Initial Pose updated:", Object.keys(initialPose).length, "bones"); }, [initialPose]);
    
    // --- Create Animation Actions ---
    useEffect(() => {
        if (mixer && skeleton && Object.keys(initialPose).length > 0) {
             let createdReset = false, createdStance = false, createdIdle = false, createdWalk = false, createdPunch = false, createdBlock = false, createdDuck = false, createdDuckKick = false, createdHello = false;
             
             // Create Reset Action (if not already created)
             if (!resetPoseAction) {
                 const resetClip = createResetPoseClip(skeleton, initialPose);
                 if (resetClip) {
                     const action = mixer.clipAction(resetClip);
                     action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
                     setResetPoseAction(action);
                     createdReset = true;
                     console.log("[Editor] Reset Pose Action created.");
                 } else { console.error("[Editor] Failed to create Reset Pose Clip/Action."); }
             }

            // Create Fight Stance Action (if not already created)
             if (!fightStanceAction) {
                 const stanceClip = createFightStanceClip(skeleton, initialPose, defaultFightStanceTargets, 'GoToFightStance', 0.5);
                 if (stanceClip) {
                     const action = mixer.clipAction(stanceClip);
                     action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
                     setFightStanceAction(action);
                     createdStance = true;
                     console.log("[Editor] Fight Stance Action created.");
                 } else { console.error("[Editor] Failed to create Fight Stance Clip/Action."); }
             }

            // Create Idle Breath Action (if not already created)
             if (!idleBreathAction) {
                 const breathClip = createIdleBreathClip(skeleton, defaultFightStanceTargets, initialPose);
                 if (breathClip) {
                     const action = mixer.clipAction(breathClip);
                     action.setLoop(THREE.LoopRepeat, Infinity);
                     setIdleBreathAction(action);
                     createdIdle = true;
                     console.log("[Editor] Idle Breath Action created.");
                 } else { console.error("[Editor] Failed to create Idle Breath Clip/Action."); }
             }

            // Create Walk Cycle Action (if not already created)
             if (!walkCycleAction) {
                 const walkClip = createWalkCycleClip(skeleton, initialPose, defaultFightStanceTargets);
                 if (walkClip) {
                     const action = mixer.clipAction(walkClip);
                     action.setLoop(THREE.LoopRepeat, Infinity); // Walk loops forever
                     setWalkCycleAction(action);
                     createdWalk = true;
                     console.log("[Editor] Walk Cycle Action created.");
                 } else { console.error("[Editor] Failed to create Walk Cycle Clip/Action."); }
             }

            // Create Right Punch Action (if not already created)
             if (!rightPunchAction) {
                 const punchClip = createRightPunchClip(skeleton, initialPose, defaultFightStanceTargets);
                 if (punchClip) {
                     const action = mixer.clipAction(punchClip);
                     action.setLoop(THREE.LoopOnce, 1); // Punch plays once
                     action.clampWhenFinished = true;
                     setRightPunchAction(action);
                     createdPunch = true; // Reuse flag maybe?
                      console.log("[Editor] Right Punch Action created.");
                 } else { console.error("[Editor] Failed to create Right Punch Clip/Action."); }
             }

            // Create Left Punch Action (if not already created)
             if (!leftPunchAction) {
                const punchClip = createLeftPunchClip(skeleton, initialPose, defaultFightStanceTargets);
                if (punchClip) {
                    const action = mixer.clipAction(punchClip);
                    action.setLoop(THREE.LoopOnce, 1); // Punch plays once
                    action.clampWhenFinished = true;
                    setLeftPunchAction(action);
                     console.log("[Editor] Left Punch Action created.");
                } else { console.error("[Editor] Failed to create Left Punch Clip/Action."); }
            }

            // Create Block Pose Action (if not already created)
             if (!blockPoseAction) {
                 const blockClip = createBlockPoseClip(skeleton, initialPose, defaultFightStanceTargets);
                 if (blockClip) {
                     const action = mixer.clipAction(blockClip);
                     action.setLoop(THREE.LoopOnce, 1); // Block transition plays once
                     action.clampWhenFinished = true; // Hold the block pose at the end
                     setBlockPoseAction(action);
                     createdBlock = true;
                     console.log("[Editor] Block Pose Action created.");
                 } else { console.error("[Editor] Failed to create Block Pose Clip/Action."); }
             }

            // Create Duck Pose Action (if not already created)
             if (!duckPoseAction) {
                 const duckClip = createDuckPoseClip(skeleton, initialPose, defaultFightStanceTargets);
                 if (duckClip) {
                     const action = mixer.clipAction(duckClip);
                     action.setLoop(THREE.LoopOnce, 1); // Duck transition plays once
                     action.clampWhenFinished = true; // Hold the duck pose
                     setDuckPoseAction(action);
                     createdDuck = true;
                     console.log("[Editor] Duck Pose Action created.");
                 } else { console.error("[Editor] Failed to create Duck Pose Clip/Action."); }
             }

             // Create Duck Kick Action (if not already created)
             if (!duckKickAction) {
                const kickClip = createDuckKickClip(skeleton, initialPose); // Doesn't need stance targets
                 if (kickClip) {
                     const action = mixer.clipAction(kickClip);
                     action.setLoop(THREE.LoopOnce, 1); // Kick plays once
                     action.clampWhenFinished = true; // Clamp at the end (returns to duck)
                     setDuckKickAction(action);
                     createdDuckKick = true;
                     console.log("[Editor] Duck Kick Action created.");
                 } else { console.error("[Editor] Failed to create Duck Kick Clip/Action."); }
             }

             // Create Transition To Hello Action (if not already created)
             if (!transitionToHelloAction) {
                const transitionClip = createTransitionToHelloClip(skeleton, initialPose, helloTargets);
                if (transitionClip) {
                    const action = mixer.clipAction(transitionClip);
                    action.setLoop(THREE.LoopOnce, 1);
                    action.clampWhenFinished = true;
                    setTransitionToHelloAction(action);
                    console.log("[Editor] TransitionToHello Action created.");
                } else { console.error("[Editor] Failed to create TransitionToHello Clip/Action."); }
             }

             // Create Hello Wave Loop Action (if not already created)
             if (!helloWaveLoopAction) {
                const helloLoopClip = createHelloWaveLoopClip(skeleton, initialPose, helloTargets);
                 console.log("[Editor] createHelloWaveLoopClip returned:", helloLoopClip); // Log the returned clip
                 if (helloLoopClip) {
                     const action = mixer.clipAction(helloLoopClip);
                     action.setLoop(THREE.LoopRepeat, Infinity); // Loop indefinitely
                     setHelloWaveLoopAction(action);
                     createdHello = true; // Keep flag for logging maybe
                     console.log("[Editor] HelloWaveLoop Action created.");
                 } else { console.error("[Editor] Failed to create HelloWaveLoop Clip/Action."); }
             }

             // Create Transition To Arms Crossed Action (if not already created)
             if (!transitionToArmsCrossedAction) {
                 const transitionClip = createTransitionToArmsCrossedClip(skeleton, initialPose, armsCrossedTargets);
                 if (transitionClip) {
                     const action = mixer.clipAction(transitionClip);
                     action.setLoop(THREE.LoopOnce, 1);
                     action.clampWhenFinished = true;
                     setTransitionToArmsCrossedAction(action);
                     console.log("[Editor] TransitionToArmsCrossed Action created.");
                 } else { console.error("[Editor] Failed to create TransitionToArmsCrossed Clip/Action."); }
             }

             // Create Arms Crossed Breath Action (if not already created)
             if (!armsCrossedBreathAction) {
                 const breathClip = createArmsCrossedBreathClip(skeleton, armsCrossedTargets, initialPose);
                 if (breathClip) {
                     const action = mixer.clipAction(breathClip);
                     action.setLoop(THREE.LoopRepeat, Infinity); // Loop indefinitely
                     setArmsCrossedBreathAction(action);
                     console.log("[Editor] ArmsCrossedBreath Action created.");
                 } else { console.error("[Editor] Failed to create ArmsCrossedBreath Clip/Action."); }
             }

             // Create Bow Action (if not already created)
             if (!bowAction) {
                 const clip = createBowClip(skeleton, initialPose);
                 if (clip) {
                     const action = mixer.clipAction(clip);
                     action.setLoop(THREE.LoopOnce, 1);
                     action.clampWhenFinished = false; // Return to initial pose
                     setBowAction(action);
                     console.log("[Editor] Bow Action created.");
                 } else { console.error("[Editor] Failed to create Bow Clip/Action."); }
             }

             // Create Fall Backward Action (if not already created)
             if (!fallBackwardAction) {
                 const clip = createFallBackwardClip(skeleton, initialPose);
                 if (clip) {
                     const action = mixer.clipAction(clip);
                     action.setLoop(THREE.LoopOnce, 1);
                     action.clampWhenFinished = true; // Hold the final fallen pose
                     setFallBackwardAction(action);
                     console.log("[Editor] Fall Backward Action created.");
                 } else { console.error("[Editor] Failed to create Fall Backward Clip/Action."); }
             }

        } else {
             // Clear actions if mixer/skeleton/pose become unavailable
             if (resetPoseAction) { resetPoseAction.stop(); setResetPoseAction(null); }
             if (fightStanceAction) { fightStanceAction.stop(); setFightStanceAction(null); }
             if (idleBreathAction) { idleBreathAction.stop(); setIdleBreathAction(null); }
             if (walkCycleAction) { walkCycleAction.stop(); setWalkCycleAction(null); }
             if (rightPunchAction) { rightPunchAction.stop(); setRightPunchAction(null); }
             if (blockPoseAction) { blockPoseAction.stop(); setBlockPoseAction(null); }
             if (duckPoseAction) { duckPoseAction.stop(); setDuckPoseAction(null); }
             if (duckKickAction) { duckKickAction.stop(); setDuckKickAction(null); }
             if (transitionToHelloAction) { transitionToHelloAction.stop(); setTransitionToHelloAction(null); }
             if (helloWaveLoopAction) { helloWaveLoopAction.stop(); setHelloWaveLoopAction(null); }
             if (transitionToArmsCrossedAction) { transitionToArmsCrossedAction.stop(); setTransitionToArmsCrossedAction(null); }
             if (armsCrossedBreathAction) { armsCrossedBreathAction.stop(); setArmsCrossedBreathAction(null); }
             if (bowAction) { bowAction.stop(); setBowAction(null); }
             if (leftPunchAction) { leftPunchAction.stop(); setLeftPunchAction(null); } // <-- ADDED CLEANUP
             if (fallBackwardAction) { fallBackwardAction.stop(); setFallBackwardAction(null); } // <-- ADDED CLEANUP
             setIsPlaying(false); // Reset playing state
             setCurrentPoseState('initial'); // Reset pose state
        }

        // Cleanup: Stop actions but don't nullify state here, let the state clearing above handle it
        return () => {
             // No explicit stop needed here if state is managed correctly on unmount/deps change
             // console.log("[Editor] Cleaning up actions (stop only)");
             // resetPoseAction?.stop();
             // fightStanceAction?.stop();
             // idleBreathAction?.stop();
        };
        // Depend on mixer, skeleton, initialPose. Also include action states to recreate if they somehow get nullified.
    }, [mixer, skeleton, initialPose, resetPoseAction, fightStanceAction, idleBreathAction, walkCycleAction, rightPunchAction, blockPoseAction, duckPoseAction, duckKickAction, transitionToHelloAction, helloWaveLoopAction, transitionToArmsCrossedAction, armsCrossedBreathAction, bowAction, leftPunchAction, fallBackwardAction]); // <-- ADDED DEPENDENCY
    
    // --- Setup Animation Listener --- // Handles transitions after animations finish
    useEffect(() => {
        if (!mixer || !idleBreathAction) return; // Need idle action too for transitions

        const onAnimationFinished = (event: AnimationFinishedEvent) => {
            // Use the STATE variables here for reliable checks
            if (fightStanceAction && event.action === fightStanceAction) {
                console.log("[Editor] Fight Stance Finished. Capturing pose and starting Idle Breath.");
                setCurrentPoseState('stance'); 
                setIsPlaying(false); 

                // CAPTURE the stable stance pose here
                if (skeleton) { 
                    const stableStancePose: StartPose = {};
                    skeleton.bones.forEach(bone => {
                        stableStancePose[bone.name] = { quat: bone.quaternion.clone() };
                    });
                    setCapturedStancePose(stableStancePose); // Store it
                    console.log("[Editor] Captured stable stance pose.");
                } else {
                     console.warn("[Editor] Skeleton not available to capture stance pose.");
                     setCapturedStancePose(null); // Clear if skeleton gone
                }

                if (idleBreathAction && idleBreathAction.weight === 0) { 
                   idleBreathAction.reset().fadeIn(0.3).play();
                } 
            } else if (resetPoseAction && event.action === resetPoseAction) {
                console.log("[Editor] Reset Pose Finished.");
                setIsPlaying(false); 
                setCurrentPoseState('initial'); 
                setCapturedStancePose(null); // Clear captured pose on reset
                setAutoRotate(true); 
            // MODIFIED CHECK: Check clip name instead of action instance for punch
            } else if (event.action.getClip().name === 'RightPunch') { 
                console.log("[Editor] Right Punch Finished. Starting Idle Breath.");
                 setCurrentPoseState('stance'); // Assume return to stance after punch for now
                 setIsPlaying(false); // Punch sequence finished
                 // Check if another action hasn't already started
                 if (idleBreathAction && idleBreathAction.weight === 0) { // Check idleBreathAction exists
                     idleBreathAction.reset().fadeIn(0.3).play();
                 }
            } else if (event.action.getClip().name === 'LeftPunch') { // <-- ADDED LEFT PUNCH CHECK
                console.log("[Editor] Left Punch Finished. Starting Idle Breath.");
                 setCurrentPoseState('stance'); // Assume return to stance after punch for now
                 setIsPlaying(false); // Punch sequence finished
                 // Check if another action hasn't already started
                 if (idleBreathAction && idleBreathAction.weight === 0) { // Check idleBreathAction exists
                     idleBreathAction.reset().fadeIn(0.3).play();
                 }
            } else if (blockPoseAction && event.action === blockPoseAction) {
                console.log("[Editor] Block Pose Finished. Holding pose.");
                setCurrentPoseState('blocking'); // Now blocking
                setIsPlaying(false); // Block transition finished
            } else if (duckPoseAction && event.action === duckPoseAction) {
                console.log("[Editor] Duck Pose Finished. Holding pose.");
                setCurrentPoseState('ducking'); // Now ducking
                setIsPlaying(false); // Duck transition finished
            } else if (duckKickAction && event.action === duckKickAction) {
                console.log("[Editor] Duck Kick Finished. Returning to Duck pose (clamped).");
                setCurrentPoseState('ducking'); // Clamped back to ducking state
                setIsPlaying(false); // Kick finished
            } else if (transitionToHelloAction && event.action === transitionToHelloAction) {
                console.log("[Editor] TransitionToHello Finished. Starting HelloWaveLoop.");
                setCurrentPoseState('waving'); // Now waving
                setIsPlaying(false); // Transition finished, loop is non-blocking
                // Start the loop
                if (helloWaveLoopAction) {
                   helloWaveLoopAction.reset().fadeIn(0.3).play();
                }
            } else if (transitionToArmsCrossedAction && event.action === transitionToArmsCrossedAction) {
                console.log("[Editor] TransitionToArmsCrossed Finished. Starting ArmsCrossedBreath.");
                setCurrentPoseState('armsCrossed');
                setIsPlaying(false);
                if (armsCrossedBreathAction) {
                    armsCrossedBreathAction.reset().fadeIn(0.3).play();
                }
            } else if (bowAction && event.action === bowAction) { // Handle Bow finished
                console.log("[Editor] Bow Finished.");
                setCurrentPoseState('initial'); // Back to initial
                setIsPlaying(false); // Animation finished
                setAutoRotate(true);
            } else if (event.action.getClip().name === 'FallBackward') { 
                console.log("[Editor] Fall Backward Finished. Holding fallen pose.");
                setCurrentPoseState('fallen'); // Define a 'fallen' state if needed
                setIsPlaying(false); // Fall sequence finished
                setAutoRotate(false); // Keep rotation off
            }
        };

        mixer.addEventListener('finished', onAnimationFinished);
        console.log("[Editor] Added 'finished' listener.");

        return () => {
            mixer.removeEventListener('finished', onAnimationFinished);
            console.log("[Editor] Removed 'finished' listener.");
        };
        // Ensure listener has access to the latest actions and state setters
    }, [mixer, fightStanceAction, resetPoseAction, idleBreathAction, rightPunchAction, leftPunchAction, blockPoseAction, duckPoseAction, duckKickAction, transitionToHelloAction, helloWaveLoopAction, transitionToArmsCrossedAction, armsCrossedBreathAction, bowAction, fallBackwardAction, setAutoRotate, setIsPlaying, setCurrentPoseState]); // <-- ADDED DEPENDENCY
    
    // --- Live Update Pose (Keep definition) ---
    useEffect(() => {
        if (!skeleton || Object.keys(initialPose).length === 0 || !levaInitialized || isPlaying || currentPoseState === 'waving' || currentPoseState === 'armsCrossed' || currentPoseState === 'bowing' || currentPoseState === 'fallen') return; // Skip direct updates if animating or waving or arms crossed or bowing or fallen
        
        console.log("[Editor] Applying static pose due to control change...");
        const controls = levaControls as any; 
        // mixer?.stopAllAction(); // Don't stop all actions when tweaking sliders
        setAutoRotate(false); 
        const targetQuaternion = new THREE.Quaternion();
        const targetEuler = new THREE.Euler();
        const deg = THREE.MathUtils.degToRad;

        // Define target rotations based on current Leva controls
        const currentTargets: Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }> = {
            // Arms
            'L_Upperarm': { rotation: { x: controls['L_Upperarm x'], y: controls['L_Upperarm y'], z: controls['L_Upperarm z'] }, eulerOrder: controls.ArmEulerOrder as EulerOrder },
            'L_Forearm': { rotation: { x: controls['L_Forearm x'], y: controls['L_Forearm y'], z: controls['L_Forearm z'] }, eulerOrder: controls.ArmEulerOrder as EulerOrder },
            'L_Hand': { rotation: { x: controls['L_Hand x'], y: controls['L_Hand y'], z: controls['L_Hand z'] }, eulerOrder: controls.ArmEulerOrder as EulerOrder },
            'R_Upperarm': { rotation: { x: controls['R_Upperarm x'], y: controls['R_Upperarm y'], z: controls['R_Upperarm z'] }, eulerOrder: controls.ArmEulerOrder as EulerOrder },
            'R_Forearm': { rotation: { x: controls['R_Forearm x'], y: controls['R_Forearm y'], z: controls['R_Forearm z'] }, eulerOrder: controls.ArmEulerOrder as EulerOrder },
            'R_Hand': { rotation: { x: controls['R_Hand x'], y: controls['R_Hand y'], z: controls['R_Hand z'] }, eulerOrder: controls.ArmEulerOrder as EulerOrder },
            // Shoulders
            'L_Clavicle': { rotation: { x: controls['L_Clavicle x'], y: controls['L_Clavicle y'], z: controls['L_Clavicle z'] }, eulerOrder: controls.ShoulderEulerOrder as EulerOrder },
            'R_Clavicle': { rotation: { x: controls['R_Clavicle x'], y: controls['R_Clavicle y'], z: controls['R_Clavicle z'] }, eulerOrder: controls.ShoulderEulerOrder as EulerOrder },
            // Legs
            'L_Thigh': { rotation: { x: controls['L_Thigh x'], y: controls['L_Thigh y'], z: controls['L_Thigh z'] }, eulerOrder: controls.LegEulerOrder as EulerOrder },
            'L_Calf': { rotation: { x: controls['L_Calf x'], y: controls['L_Calf y'], z: controls['L_Calf z'] }, eulerOrder: controls.LegEulerOrder as EulerOrder },
            'L_Foot': { rotation: { x: controls['L_Foot x'], y: controls['L_Foot y'], z: controls['L_Foot z'] }, eulerOrder: controls.LegEulerOrder as EulerOrder },
            'R_Thigh': { rotation: { x: controls['R_Thigh x'], y: controls['R_Thigh y'], z: controls['R_Thigh z'] }, eulerOrder: controls.LegEulerOrder as EulerOrder },
            'R_Calf': { rotation: { x: controls['R_Calf x'], y: controls['R_Calf y'], z: controls['R_Calf z'] }, eulerOrder: controls.LegEulerOrder as EulerOrder },
            'R_Foot': { rotation: { x: controls['R_Foot x'], y: controls['R_Foot y'], z: controls['R_Foot z'] }, eulerOrder: controls.LegEulerOrder as EulerOrder },
            // Torso
            'Hip': { rotation: { x: controls['Hip x'], y: controls['Hip y'], z: controls['Hip z'] }, eulerOrder: controls.TorsoEulerOrder as EulerOrder },
            'Pelvis': { rotation: { x: controls['Pelvis x'], y: controls['Pelvis y'], z: controls['Pelvis z'] }, eulerOrder: controls.TorsoEulerOrder as EulerOrder },
            'Waist': { rotation: { x: controls['Waist x'], y: controls['Waist y'], z: controls['Waist z'] }, eulerOrder: controls.TorsoEulerOrder as EulerOrder },
            'Spine01': { rotation: { x: controls['Spine01 x'], y: controls['Spine01 y'], z: controls['Spine01 z'] }, eulerOrder: controls.TorsoEulerOrder as EulerOrder },
            'Spine02': { rotation: { x: controls['Spine02 x'], y: controls['Spine02 y'], z: controls['Spine02 z'] }, eulerOrder: controls.TorsoEulerOrder as EulerOrder },
            // Head/Neck
            'NeckTwist01': { rotation: { x: controls['NeckTwist01 x'], y: controls['NeckTwist01 y'], z: controls['NeckTwist01 z'] }, eulerOrder: controls.HeadNeckEulerOrder as EulerOrder },
            'NeckTwist02': { rotation: { x: controls['NeckTwist02 x'], y: controls['NeckTwist02 y'], z: controls['NeckTwist02 z'] }, eulerOrder: controls.HeadNeckEulerOrder as EulerOrder },
            'Head': { rotation: { x: controls['Head x'], y: controls['Head y'], z: controls['Head z'] }, eulerOrder: controls.HeadNeckEulerOrder as EulerOrder },
        };

        // Apply rotations to bones
        skeleton.bones.forEach(bone => {
            const boneName = bone.name;
            const targetInfo = currentTargets[boneName];
            const initial = initialPose[boneName];
            
            if (!initial) return; // Skip if no initial pose data for this bone

            if (targetInfo?.rotation) {
                const eulerOrder = targetInfo.eulerOrder || 'XYZ'; // Default to XYZ if somehow missing
                const r = targetInfo.rotation;
                targetEuler.set(deg(r.x ?? 0), deg(r.y ?? 0), deg(r.z ?? 0), eulerOrder);
                targetQuaternion.setFromEuler(targetEuler);
                bone.quaternion.copy(targetQuaternion);
            } else {
                // If no controls for this bone, reset to its initial quaternion only if NOT animating
                if (!isPlaying) {
                bone.quaternion.copy(initial.quat);
                }
            }
        });
    }, [levaControls, skeleton, initialPose, setAutoRotate, levaInitialized, isPlaying, currentPoseState]);
    
    // --- Reset Pose Handler (Update for fades and state) ---
    const triggerResetPose = useCallback(() => {
        // Use state variables for checks
        if (!resetPoseAction || !mixer) return; // Simpler check
        console.log("[Editor] Triggering Reset Pose...");
        setIsPlaying(true); // Reset IS a blocking action
        setCurrentPoseState('transitioning'); // Mark as transitioning
        setAutoRotate(false); // Keep off until reset finishes via the listener

        // Stop other actions cleanly using fades
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2);
        walkCycleAction?.fadeOut(0.2);
        rightPunchAction?.fadeOut(0.2);
        blockPoseAction?.fadeOut(0.2);
        duckPoseAction?.fadeOut(0.2);
        duckKickAction?.fadeOut(0.2);
        transitionToHelloAction?.fadeOut(0.2);
        helloWaveLoopAction?.fadeOut(0.2);
        transitionToArmsCrossedAction?.fadeOut(0.2);
        armsCrossedBreathAction?.fadeOut(0.2);
        bowAction?.fadeOut(0.2); // New
        leftPunchAction?.fadeOut(0.2); // <-- ADDED FADE OUT
        fallBackwardAction?.fadeOut(0.2); // <-- ADDED FADE OUT

        // Play reset with fade in
        resetPoseAction.reset().fadeIn(0.2).play();

        // Reset Leva controls immediately
        const initialEuler = new THREE.Euler();
        const rad = THREE.MathUtils.radToDeg;
        const updates: Record<string, number | string> = {}; 
        const updateFromBone = (boneName: string, controlPrefix: string, eulerOrder: EulerOrder) => {
            const initial = initialPose[boneName];
            if (initial) {
                initialEuler.setFromQuaternion(initial.quat, eulerOrder);
                updates[`${controlPrefix} x`] = rad(initialEuler.x);
                updates[`${controlPrefix} y`] = rad(initialEuler.y);
                updates[`${controlPrefix} z`] = rad(initialEuler.z);
            } // No warning needed here, already handled during init
        };

        // Use the same default Euler orders as in initialization
        const initialArmOrder = 'XYZ' as EulerOrder;
        const initialShoulderOrder = 'XYZ' as EulerOrder;
        const initialLegOrder = 'YXZ' as EulerOrder;
        const initialTorsoOrder = 'XYZ' as EulerOrder;
        const initialHeadNeckOrder = 'XYZ' as EulerOrder;

        // Update bones for each group
        updateFromBone('L_Upperarm', 'L_Upperarm', initialArmOrder);
        updateFromBone('L_Forearm', 'L_Forearm', initialArmOrder);
        updateFromBone('L_Hand', 'L_Hand', initialArmOrder);
        updateFromBone('R_Upperarm', 'R_Upperarm', initialArmOrder);
        updateFromBone('R_Forearm', 'R_Forearm', initialArmOrder);
        updateFromBone('R_Hand', 'R_Hand', initialArmOrder);
        
        updateFromBone('L_Clavicle', 'L_Clavicle', initialShoulderOrder);
        updateFromBone('R_Clavicle', 'R_Clavicle', initialShoulderOrder);

        updateFromBone('L_Thigh', 'L_Thigh', initialLegOrder);
        updateFromBone('L_Calf', 'L_Calf', initialLegOrder);
        updateFromBone('L_Foot', 'L_Foot', initialLegOrder);
        updateFromBone('R_Thigh', 'R_Thigh', initialLegOrder);
        updateFromBone('R_Calf', 'R_Calf', initialLegOrder);
        updateFromBone('R_Foot', 'R_Foot', initialLegOrder);

        updateFromBone('Hip', 'Hip', initialTorsoOrder);
        updateFromBone('Pelvis', 'Pelvis', initialTorsoOrder);
        updateFromBone('Waist', 'Waist', initialTorsoOrder);
        updateFromBone('Spine01', 'Spine01', initialTorsoOrder);
        updateFromBone('Spine02', 'Spine02', initialTorsoOrder);

        updateFromBone('NeckTwist01', 'NeckTwist01', initialHeadNeckOrder);
        updateFromBone('NeckTwist02', 'NeckTwist02', initialHeadNeckOrder);
        updateFromBone('Head', 'Head', initialHeadNeckOrder);

        // Set initial Euler orders in Leva
        updates['ArmEulerOrder'] = initialArmOrder;
        updates['ShoulderEulerOrder'] = initialShoulderOrder;
        updates['LegEulerOrder'] = initialLegOrder;
        updates['TorsoEulerOrder'] = initialTorsoOrder;
        updates['HeadNeckEulerOrder'] = initialHeadNeckOrder;
        
        // Apply all updates to Leva
        setLevaControls(updates);

    }, [resetPoseAction, fightStanceAction, idleBreathAction, walkCycleAction, rightPunchAction, blockPoseAction, duckPoseAction, duckKickAction, transitionToHelloAction, helloWaveLoopAction, transitionToArmsCrossedAction, armsCrossedBreathAction, bowAction, leftPunchAction, fallBackwardAction, mixer, setAutoRotate, initialPose, skeleton, setLevaControls, setIsPlaying, setCurrentPoseState]);

    // --- Fight Stance Handler (Update for fades and state) ---
    const triggerFightStance = useCallback(() => {
        // Use state variables for checks
        if (!fightStanceAction || !mixer) return; // Simpler check
        console.log("[Editor] Triggering Fight Stance Sequence...");
        setIsPlaying(true); // Stance transition IS a blocking action
        setCurrentPoseState('transitioning'); // Mark as transitioning
        setAutoRotate(false);
        
        // Stop other actions cleanly using fades
        resetPoseAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2); // Fade out idle if it was playing
        walkCycleAction?.fadeOut(0.2); // Stop walk if playing
        rightPunchAction?.fadeOut(0.2); // Stop punch if playing
        blockPoseAction?.fadeOut(0.2); // Stop block if active
        duckPoseAction?.fadeOut(0.2); // Stop duck if active
        duckKickAction?.fadeOut(0.2); // Stop duck kick
        transitionToHelloAction?.fadeOut(0.2);
        helloWaveLoopAction?.fadeOut(0.2);
        transitionToArmsCrossedAction?.fadeOut(0.2);
        armsCrossedBreathAction?.fadeOut(0.2);
        bowAction?.fadeOut(0.2); // New
        leftPunchAction?.fadeOut(0.2); // <-- ADDED FADE OUT
        fallBackwardAction?.fadeOut(0.2); // <-- ADDED FADE OUT
        
        // Play stance with fade in
        fightStanceAction.reset().fadeIn(0.2).play();

        // Update Leva controls immediately to match the target stance
        const updates: Record<string, number | string> = {}; 
        Object.entries(defaultFightStanceTargets).forEach(([boneName, targetInfo]) => {
            if (targetInfo.rotation) {
                const controlPrefix = boneName;
                updates[`${controlPrefix} x`] = targetInfo.rotation.x ?? 0;
                updates[`${controlPrefix} y`] = targetInfo.rotation.y ?? 0;
                updates[`${controlPrefix} z`] = targetInfo.rotation.z ?? 0;
                
                // Update the relevant Euler order selector based on the target definition
                // This assumes a naming convention: BoneName -> ControlGroupName + EulerOrder
                let groupEulerControlName = '';
                if (['L_Upperarm', 'R_Upperarm', 'L_Forearm', 'R_Forearm', 'L_Hand', 'R_Hand'].includes(boneName)) {
                    groupEulerControlName = 'ArmEulerOrder';
                } else if (['L_Clavicle', 'R_Clavicle'].includes(boneName)) {
                    groupEulerControlName = 'ShoulderEulerOrder';
                } else if (['L_Thigh', 'R_Thigh', 'L_Calf', 'R_Calf', 'L_Foot', 'R_Foot'].includes(boneName)) {
                    groupEulerControlName = 'LegEulerOrder';
                } else if (['Hip', 'Pelvis', 'Waist', 'Spine01', 'Spine02'].includes(boneName)) {
                    groupEulerControlName = 'TorsoEulerOrder';
                } else if (['NeckTwist01', 'NeckTwist02', 'Head'].includes(boneName)) {
                    groupEulerControlName = 'HeadNeckEulerOrder';
                }
                if (groupEulerControlName && targetInfo.eulerOrder) {
                    updates[groupEulerControlName] = targetInfo.eulerOrder;
                }
            }
        });

        // Fill in missing Euler orders if not set by any bone in the group
        if (!updates['ArmEulerOrder']) updates['ArmEulerOrder'] = 'XYZ';
        if (!updates['ShoulderEulerOrder']) updates['ShoulderEulerOrder'] = 'XYZ';
        if (!updates['LegEulerOrder']) updates['LegEulerOrder'] = 'YXZ'; // Match default
        if (!updates['TorsoEulerOrder']) updates['TorsoEulerOrder'] = 'XYZ';
        if (!updates['HeadNeckEulerOrder']) updates['HeadNeckEulerOrder'] = 'XYZ';

        // Apply all updates to Leva
        setLevaControls(updates);
        setLevaInitialized(true); // Ensure Leva knows it's been intentionally set

    }, [fightStanceAction, resetPoseAction, idleBreathAction, walkCycleAction, rightPunchAction, blockPoseAction, duckPoseAction, duckKickAction, transitionToHelloAction, helloWaveLoopAction, transitionToArmsCrossedAction, armsCrossedBreathAction, bowAction, leftPunchAction, fallBackwardAction, mixer, setAutoRotate, initialPose, skeleton, setLevaControls, setIsPlaying, setCurrentPoseState]); // <-- ADDED DEPENDENCY

    // --- Walk Cycle Handler ---
    const triggerWalkCycle = useCallback(() => {
        if (!walkCycleAction || !mixer) return;
        console.log("[Editor] Triggering Walk Cycle...");
        setIsPlaying(false); // Walk is NOT blocking Leva
        setCurrentPoseState('walking'); // Set state to walking
        setAutoRotate(false);

        // Stop other actions cleanly using fades
        resetPoseAction?.fadeOut(0.2);
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2);
        rightPunchAction?.fadeOut(0.2);
        blockPoseAction?.fadeOut(0.2);
        duckPoseAction?.fadeOut(0.2);
        duckKickAction?.fadeOut(0.2); // Stop duck kick
        transitionToHelloAction?.fadeOut(0.2);
        helloWaveLoopAction?.fadeOut(0.2);
        transitionToArmsCrossedAction?.fadeOut(0.2);
        armsCrossedBreathAction?.fadeOut(0.2);
        bowAction?.fadeOut(0.2); // New
        leftPunchAction?.fadeOut(0.2); // <-- ADDED FADE OUT
        fallBackwardAction?.fadeOut(0.2); // <-- ADDED FADE OUT

        // Play walk cycle with fade in (loops)
        walkCycleAction.reset().fadeIn(0.2).play();

        // DO NOT update Leva controls for walk cycle

    }, [walkCycleAction, resetPoseAction, fightStanceAction, idleBreathAction, rightPunchAction, blockPoseAction, duckPoseAction, duckKickAction, transitionToHelloAction, helloWaveLoopAction, transitionToArmsCrossedAction, armsCrossedBreathAction, bowAction, leftPunchAction, fallBackwardAction, mixer, setAutoRotate, setIsPlaying, setCurrentPoseState]); // <-- ADDED DEPENDENCY

    // --- Right Punch Handler ---
    const triggerRightPunch = useCallback(() => {
        // Ensure skeleton, mixer, and the state action are available
        if (!skeleton || !mixer || !rightPunchAction) { // Check rightPunchAction state too
             console.error("[Editor] Cannot trigger punch: Skeleton, Mixer or Action missing.");
             return;
        }
        
        // Determine the correct starting pose
        let startPoseForClip: StartPose | null = null;
        if (currentPoseState === 'stance' && capturedStancePose) {
            startPoseForClip = capturedStancePose; 
            console.log("[Editor] Using CAPTURED stance pose for punch.");
        } else {
            console.log("[Editor] Capturing LIVE pose for punch (not in stance or no captured pose).");
            const livePose: StartPose = {};
            skeleton.bones.forEach(bone => {
                livePose[bone.name] = { quat: bone.quaternion.clone() };
            });
            startPoseForClip = livePose;
        }

        // CREATE a new clip using the determined start pose
        const newPunchClip = createRightPunchClip(
            skeleton, 
            initialPose, 
            defaultFightStanceTargets, 
            startPoseForClip, 
            'RightPunch' 
        );

        if (!newPunchClip) {
            console.error("[Editor] Failed to create dynamic Right Punch Clip.");
            return;
        }

        // REPLACE the clip associated with the existing action state
        const oldAction = rightPunchAction; // Get action from state
        const oldClip = oldAction.getClip();

        oldAction.stop(); // Stop the old action if it was playing
        mixer.uncacheAction(oldClip, oldAction.getRoot()); // Uncache the action/clip link
        mixer.uncacheClip(oldClip); // Uncache the clip data

        const newAction = mixer.clipAction(newPunchClip); // Create new action with new clip
        newAction.setLoop(THREE.LoopOnce, 1); 
        newAction.clampWhenFinished = true;

        setRightPunchAction(newAction); // UPDATE the state with the new action object

        console.log("[Editor] Triggering Right Punch with updated clip/action...");
        setIsPlaying(true); 
        setCurrentPoseState('punching'); 
        setAutoRotate(false);

        // Stop other actions cleanly using fades
        resetPoseAction?.fadeOut(0.2);
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2);
        walkCycleAction?.fadeOut(0.2);
        // No need to fade out oldAction here, it's been stopped and uncached
        blockPoseAction?.fadeOut(0.2);
        duckPoseAction?.fadeOut(0.2);
        duckKickAction?.fadeOut(0.2); 
        transitionToHelloAction?.fadeOut(0.2);
        helloWaveLoopAction?.fadeOut(0.2);
        transitionToArmsCrossedAction?.fadeOut(0.2);
        armsCrossedBreathAction?.fadeOut(0.2);
        bowAction?.fadeOut(0.2);
        leftPunchAction?.fadeOut(0.2); // <-- ADDED FADE OUT
        fallBackwardAction?.fadeOut(0.2); // <-- ADDED FADE OUT

        // Play the NEW action (which is now also in state)
        newAction.reset().fadeIn(0.2).play();

    }, [
        skeleton, 
        mixer, 
        initialPose, 
        defaultFightStanceTargets, 
        currentPoseState, 
        capturedStancePose, 
        // Actions to check/fade out
        resetPoseAction, 
        fightStanceAction, 
        idleBreathAction, 
        walkCycleAction, 
        rightPunchAction, // Include the state variable itself
        blockPoseAction, 
        duckPoseAction, 
        duckKickAction, 
        transitionToHelloAction, 
        helloWaveLoopAction, 
        transitionToArmsCrossedAction, 
        armsCrossedBreathAction, 
        bowAction, 
        leftPunchAction, // <-- ADDED DEPENDENCY
        fallBackwardAction, // <-- ADDED DEPENDENCY
        // State setters
        setRightPunchAction, 
        setAutoRotate, 
        setIsPlaying, 
        setCurrentPoseState
    ]); 

    // --- Block Pose Handler ---
    const triggerBlockPose = useCallback(() => {
        if (!blockPoseAction || !mixer) return;
        console.log("[Editor] Triggering Block Pose...");
        setIsPlaying(true); // Block transition IS a blocking action
        setCurrentPoseState('transitioning'); // Mark as transitioning (will become 'blocking' on finish)
        setAutoRotate(false);

        // Stop other actions cleanly using fades
        resetPoseAction?.fadeOut(0.2);
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2);
        walkCycleAction?.fadeOut(0.2);
        rightPunchAction?.fadeOut(0.2);
        duckPoseAction?.fadeOut(0.2);
        duckKickAction?.fadeOut(0.2); // Stop duck kick
        transitionToHelloAction?.fadeOut(0.2);
        helloWaveLoopAction?.fadeOut(0.2);
        transitionToArmsCrossedAction?.fadeOut(0.2);
        armsCrossedBreathAction?.fadeOut(0.2);
        bowAction?.fadeOut(0.2); // New
        leftPunchAction?.fadeOut(0.2); // <-- ADDED FADE OUT
        fallBackwardAction?.fadeOut(0.2); // <-- ADDED FADE OUT

        // Play block animation with fade in (plays once, clamps)
        blockPoseAction.reset().fadeIn(0.2).play();

        // Update Leva controls immediately to match the target block pose
        // Use the imported blockTargets constant
        const blockTargetsForLeva = blockTargets as Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }>;
        if (blockTargetsForLeva) {
             const updates: Record<string, number | string> = {}; 
             Object.entries(blockTargetsForLeva).forEach(([boneName, targetInfo]) => {
                 if (targetInfo.rotation) {
                     const controlPrefix = boneName;
                     updates[`${controlPrefix} x`] = targetInfo.rotation.x ?? 0;
                     updates[`${controlPrefix} y`] = targetInfo.rotation.y ?? 0;
                     updates[`${controlPrefix} z`] = targetInfo.rotation.z ?? 0;
                     
                     // Update relevant Euler order selector
                     let groupEulerControlName = '';
                     if (['L_Upperarm', 'R_Upperarm', 'L_Forearm', 'R_Forearm', 'L_Hand', 'R_Hand'].includes(boneName)) {
                         groupEulerControlName = 'ArmEulerOrder';
                     }
                     // Add other groups if blockTargets ever includes them
                     if (groupEulerControlName && targetInfo.eulerOrder) {
                         updates[groupEulerControlName] = targetInfo.eulerOrder;
                     }
                 }
             });

             // Set defaults only for groups NOT touched by blockTargets (which is only Arms currently)
             if (!updates['ArmEulerOrder']) updates['ArmEulerOrder'] = 'XYZ';
             // Keep other groups based on current Leva state or default?
             // For simplicity, let's just update the arms group order and values.
             // const currentLeva = get(); // Need Leva access if keeping others
             // updates['ShoulderEulerOrder'] = currentLeva.ShoulderEulerOrder;
             // updates['LegEulerOrder'] = currentLeva.LegEulerOrder;
             // updates['TorsoEulerOrder'] = currentLeva.TorsoEulerOrder;
             // updates['HeadNeckEulerOrder'] = currentLeva.HeadNeckEulerOrder;

             setLevaControls(updates); 
             console.log("[Editor] Updated Leva controls for Block Pose.")
        } else {
             console.warn("[Editor] Imported blockTargets constant is missing?"); // Should not happen
        }

    }, [blockPoseAction, resetPoseAction, fightStanceAction, idleBreathAction, walkCycleAction, rightPunchAction, duckPoseAction, duckKickAction, transitionToHelloAction, helloWaveLoopAction, transitionToArmsCrossedAction, armsCrossedBreathAction, bowAction, leftPunchAction, fallBackwardAction, mixer, setAutoRotate, setIsPlaying, setLevaControls, setCurrentPoseState]); // <-- ADDED DEPENDENCY

    // --- Duck Pose Handler ---
    const triggerDuckPose = useCallback(() => {
        if (!duckPoseAction || !mixer) return;
        console.log("[Editor] Triggering Duck Pose...");
        setIsPlaying(true); // Duck transition IS a blocking action
        setCurrentPoseState('transitioning'); // Mark as transitioning (will become 'ducking' on finish)
        setAutoRotate(false);

        // Stop other actions cleanly using fades
        resetPoseAction?.fadeOut(0.2);
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2);
        walkCycleAction?.fadeOut(0.2);
        rightPunchAction?.fadeOut(0.2);
        blockPoseAction?.fadeOut(0.2);
        duckKickAction?.fadeOut(0.2); // Stop duck kick (shouldn't be playing, but good practice)
        transitionToHelloAction?.fadeOut(0.2);
        helloWaveLoopAction?.fadeOut(0.2);
        transitionToArmsCrossedAction?.fadeOut(0.2);
        armsCrossedBreathAction?.fadeOut(0.2);
        bowAction?.fadeOut(0.2); // New
        leftPunchAction?.fadeOut(0.2); // <-- ADDED FADE OUT
        fallBackwardAction?.fadeOut(0.2); // <-- ADDED FADE OUT

        // Play duck animation with fade in (plays once, clamps)
        duckPoseAction.reset().fadeIn(0.2).play();

        // Update Leva controls to match duck pose
        const duckTargetsForLeva = duckTargets as Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }>;
        if (duckTargetsForLeva) {
             const updates: Record<string, number | string> = {}; 
             Object.entries(duckTargetsForLeva).forEach(([boneName, targetInfo]) => {
                 if (targetInfo.rotation) {
                     const controlPrefix = boneName;
                     updates[`${controlPrefix} x`] = targetInfo.rotation.x ?? 0;
                     updates[`${controlPrefix} y`] = targetInfo.rotation.y ?? 0;
                     updates[`${controlPrefix} z`] = targetInfo.rotation.z ?? 0;
                     
                     // Update relevant Euler order selector
                     let groupEulerControlName = '';
                     // Check groups that ARE included in duckTargets
                     if ([/* Legs */ 'L_Thigh', 'L_Calf', 'L_Foot', 'R_Thigh', 'R_Calf', 'R_Foot'].includes(boneName)) groupEulerControlName = 'LegEulerOrder'; 
                     else if ([/* Torso */ 'Pelvis', 'Waist', 'Spine01', 'Spine02'].includes(boneName)) groupEulerControlName = 'TorsoEulerOrder'; 
                     else if ([/* Head/Neck */ 'Head'].includes(boneName)) groupEulerControlName = 'HeadNeckEulerOrder';
                     
                     if (groupEulerControlName && targetInfo.eulerOrder) {
                         updates[groupEulerControlName] = targetInfo.eulerOrder;
                     }
                 }
             });
             setLevaControls(updates);
             console.log("[Editor] Updated Leva controls for Duck Pose.");
        } else {
             console.warn("[Editor] Imported duckTargets constant is missing?");
        }

    }, [duckPoseAction, resetPoseAction, fightStanceAction, idleBreathAction, walkCycleAction, rightPunchAction, blockPoseAction, duckKickAction, transitionToHelloAction, helloWaveLoopAction, transitionToArmsCrossedAction, armsCrossedBreathAction, bowAction, leftPunchAction, fallBackwardAction, mixer, setAutoRotate, setIsPlaying, setLevaControls, setCurrentPoseState]); // <-- ADDED DEPENDENCY

    // --- Duck Kick Handler ---
    const triggerDuckKick = useCallback(() => {
        // Check if the character is currently in the 'ducking' state
        if (currentPoseState !== 'ducking' || !duckKickAction || !mixer) { 
             console.warn("[Editor] Cannot trigger Duck Kick: Not in ducking state or action/mixer missing.");
             return;
        } 
        
        console.log("[Editor] Triggering Duck Kick...");
        setIsPlaying(true); // Kick IS a blocking action
        setCurrentPoseState('kicking'); // Mark state as kicking
        setAutoRotate(false);

        // Stop other actions (mostly just duck pose hold should be active, but fade out defensively)
        resetPoseAction?.fadeOut(0.2);
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2);
        walkCycleAction?.fadeOut(0.2);
        rightPunchAction?.fadeOut(0.2);
        blockPoseAction?.fadeOut(0.2);
        duckPoseAction?.fadeOut(0.1); // Fade out the held duck pose quickly
        transitionToHelloAction?.fadeOut(0.2);
        helloWaveLoopAction?.fadeOut(0.2);
        transitionToArmsCrossedAction?.fadeOut(0.2);
        armsCrossedBreathAction?.fadeOut(0.2);
        bowAction?.fadeOut(0.2); // New
        leftPunchAction?.fadeOut(0.2); // <-- ADDED FADE OUT
        fallBackwardAction?.fadeOut(0.2); // <-- ADDED FADE OUT

        // Play kick animation with fade in (plays once, clamps back to duck)
        duckKickAction.reset().fadeIn(0.2).play();

        // DO NOT update Leva controls for kick

    }, [duckKickAction, duckPoseAction, resetPoseAction, fightStanceAction, idleBreathAction, walkCycleAction, rightPunchAction, blockPoseAction, transitionToHelloAction, helloWaveLoopAction, transitionToArmsCrossedAction, armsCrossedBreathAction, bowAction, leftPunchAction, fallBackwardAction, mixer, setAutoRotate, setIsPlaying, setCurrentPoseState, currentPoseState]); // <-- ADDED DEPENDENCY

    // --- Hello Handler ---
    const triggerHello = useCallback(() => {
        if (!transitionToHelloAction || !helloWaveLoopAction || !mixer) return;
        console.log("[Editor] Triggering Hello Transition...");
        setIsPlaying(true); // Transition IS a blocking action
        setCurrentPoseState('transitioning'); // Mark state as transitioning to wave
        setAutoRotate(false);

        // Stop other actions cleanly using fades
        resetPoseAction?.fadeOut(0.2);
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2);
        walkCycleAction?.fadeOut(0.2);
        rightPunchAction?.fadeOut(0.2);
        blockPoseAction?.fadeOut(0.2);
        duckPoseAction?.fadeOut(0.2);
        duckKickAction?.fadeOut(0.2);
        helloWaveLoopAction?.fadeOut(0.2);
        transitionToArmsCrossedAction?.fadeOut(0.2);
        armsCrossedBreathAction?.fadeOut(0.2);
        bowAction?.fadeOut(0.2); // New
        leftPunchAction?.fadeOut(0.2); // <-- ADDED FADE OUT
        fallBackwardAction?.fadeOut(0.2); // <-- ADDED FADE OUT

        // Play hello transition animation with fade in (plays once)
        transitionToHelloAction.reset().fadeIn(0.2).play();

        // DO NOT update Leva controls 

    }, [transitionToHelloAction, helloWaveLoopAction, resetPoseAction, fightStanceAction, idleBreathAction, walkCycleAction, rightPunchAction, blockPoseAction, duckPoseAction, duckKickAction, transitionToArmsCrossedAction, armsCrossedBreathAction, bowAction, leftPunchAction, fallBackwardAction, mixer, setAutoRotate, setIsPlaying, setCurrentPoseState]); // <-- ADDED DEPENDENCY

    // --- Arms Crossed Handler ---
    const triggerArmsCrossed = useCallback(() => {
        if (!transitionToArmsCrossedAction || !armsCrossedBreathAction || !mixer) return;
        console.log("[Editor] Triggering Arms Crossed Transition...");
        setIsPlaying(true); // Transition is blocking
        setCurrentPoseState('transitioning'); // Mark state
        setAutoRotate(false);

        // Stop other actions cleanly
        resetPoseAction?.fadeOut(0.2);
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2);
        walkCycleAction?.fadeOut(0.2);
        rightPunchAction?.fadeOut(0.2);
        blockPoseAction?.fadeOut(0.2);
        duckPoseAction?.fadeOut(0.2);
        duckKickAction?.fadeOut(0.2);
        transitionToHelloAction?.fadeOut(0.2); 
        helloWaveLoopAction?.fadeOut(0.2); 
        armsCrossedBreathAction?.fadeOut(0.2); // Stop breath loop if already playing
        bowAction?.fadeOut(0.2); // New
        leftPunchAction?.fadeOut(0.2); // <-- ADDED FADE OUT
        fallBackwardAction?.fadeOut(0.2); // <-- ADDED FADE OUT

        // Play transition animation (plays once)
        transitionToArmsCrossedAction.reset().fadeIn(0.2).play();

        // Optional: Update Leva controls to match target pose immediately? 
        // Similar to how triggerFightStance does it, if desired.

    }, [transitionToArmsCrossedAction, armsCrossedBreathAction, resetPoseAction, fightStanceAction, idleBreathAction, walkCycleAction, rightPunchAction, blockPoseAction, duckPoseAction, duckKickAction, transitionToHelloAction, helloWaveLoopAction, bowAction, leftPunchAction, fallBackwardAction, mixer, setAutoRotate, setIsPlaying, setCurrentPoseState]); // <-- ADDED DEPENDENCY

    // --- Bow Handler ---
    const triggerBow = useCallback(() => {
        if (!bowAction || !mixer) return;
        console.log("[Editor] Triggering Bow...");
        setIsPlaying(true); // Bow is blocking
        setCurrentPoseState('bowing'); // Mark state
        setAutoRotate(false);

        // Stop other actions cleanly
        resetPoseAction?.fadeOut(0.2);
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2);
        walkCycleAction?.fadeOut(0.2);
        rightPunchAction?.fadeOut(0.2);
        blockPoseAction?.fadeOut(0.2);
        duckPoseAction?.fadeOut(0.2);
        duckKickAction?.fadeOut(0.2);
        transitionToHelloAction?.fadeOut(0.2); 
        helloWaveLoopAction?.fadeOut(0.2); 
        transitionToArmsCrossedAction?.fadeOut(0.2);
        armsCrossedBreathAction?.fadeOut(0.2); 
        leftPunchAction?.fadeOut(0.2); // <-- ADDED FADE OUT
        fallBackwardAction?.fadeOut(0.2); // <-- ADDED FADE OUT

        // Play bow animation (plays once)
        bowAction.reset().fadeIn(0.2).play();

    }, [bowAction, /* list all other actions */ resetPoseAction, fightStanceAction, idleBreathAction, walkCycleAction, rightPunchAction, blockPoseAction, duckPoseAction, duckKickAction, transitionToHelloAction, helloWaveLoopAction, transitionToArmsCrossedAction, armsCrossedBreathAction, leftPunchAction, fallBackwardAction, mixer, setAutoRotate, setIsPlaying, setCurrentPoseState]); // <-- ADDED DEPENDENCY

    // --- Left Punch Handler ---
    const triggerLeftPunch = useCallback(() => {
        // Ensure skeleton, mixer, and the state action are available
        if (!skeleton || !mixer || !leftPunchAction) { // Check leftPunchAction state too
             console.error("[Editor] Cannot trigger left punch: Skeleton, Mixer or Action missing.");
             return;
        }
        
        // Determine the correct starting pose
        let startPoseForClip: StartPose | null = null;
        if (currentPoseState === 'stance' && capturedStancePose) {
            startPoseForClip = capturedStancePose; 
            console.log("[Editor] Using CAPTURED stance pose for left punch.");
        } else {
            console.log("[Editor] Capturing LIVE pose for left punch (not in stance or no captured pose).");
            const livePose: StartPose = {};
            skeleton.bones.forEach(bone => {
                livePose[bone.name] = { quat: bone.quaternion.clone() };
            });
            startPoseForClip = livePose;
        }

        // CREATE a new clip using the determined start pose
        const newPunchClip = createLeftPunchClip(
            skeleton, 
            initialPose, 
            defaultFightStanceTargets, 
            startPoseForClip, 
            'LeftPunch' 
        );

        if (!newPunchClip) {
            console.error("[Editor] Failed to create dynamic Left Punch Clip.");
            return;
        }

        // REPLACE the clip associated with the existing action state
        const oldAction = leftPunchAction; // Get action from state
        const oldClip = oldAction.getClip();

        oldAction.stop(); // Stop the old action if it was playing
        mixer.uncacheAction(oldClip, oldAction.getRoot()); // Uncache the action/clip link
        mixer.uncacheClip(oldClip); // Uncache the clip data

        const newAction = mixer.clipAction(newPunchClip); // Create new action with new clip
        newAction.setLoop(THREE.LoopOnce, 1); 
        newAction.clampWhenFinished = true;

        setLeftPunchAction(newAction); // UPDATE the state with the new action object

        console.log("[Editor] Triggering Left Punch with updated clip/action...");
        setIsPlaying(true); 
        setCurrentPoseState('punching'); 
        setAutoRotate(false);

        // Stop other actions cleanly using fades
        resetPoseAction?.fadeOut(0.2);
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2);
        walkCycleAction?.fadeOut(0.2);
        rightPunchAction?.fadeOut(0.2); // Stop right punch if playing
        blockPoseAction?.fadeOut(0.2);
        duckPoseAction?.fadeOut(0.2);
        duckKickAction?.fadeOut(0.2); 
        transitionToHelloAction?.fadeOut(0.2);
        helloWaveLoopAction?.fadeOut(0.2);
        transitionToArmsCrossedAction?.fadeOut(0.2);
        armsCrossedBreathAction?.fadeOut(0.2);
        bowAction?.fadeOut(0.2);
        fallBackwardAction?.fadeOut(0.2); // <-- ADDED FADE OUT

        // Play the NEW action (which is now also in state)
        newAction.reset().fadeIn(0.2).play();

    }, [
        skeleton, 
        mixer, 
        initialPose, 
        defaultFightStanceTargets, 
        currentPoseState, 
        capturedStancePose, 
        // Actions to check/fade out
        resetPoseAction, 
        fightStanceAction, 
        idleBreathAction, 
        walkCycleAction, 
        rightPunchAction, 
        leftPunchAction, // Include the state variable itself
        blockPoseAction, 
        duckPoseAction, 
        duckKickAction, 
        transitionToHelloAction, 
        helloWaveLoopAction, 
        transitionToArmsCrossedAction, 
        armsCrossedBreathAction, 
        bowAction, 
        fallBackwardAction, // <-- ADDED DEPENDENCY
        // State setters
        setLeftPunchAction, 
        setAutoRotate, 
        setIsPlaying, 
        setCurrentPoseState
    ]); 

    // --- Fall Backward Handler ---
    const triggerFallBackward = useCallback(() => {
        if (!skeleton || !mixer || !fallBackwardAction) {
             console.error("[Editor] Cannot trigger Fall Backward: Skeleton, Mixer or Action missing.");
             return;
        }

        // Capture the current pose dynamically
        const livePose: StartPose = {};
        skeleton.bones.forEach(bone => {
            livePose[bone.name] = { quat: bone.quaternion.clone() };
        });
        console.log("[Editor] Capturing LIVE pose for Fall Backward.");

        // CREATE a new clip using the live start pose
        const newFallClip = createFallBackwardClip(
            skeleton, 
            initialPose, 
            livePose, 
            'FallBackward' 
        );

        if (!newFallClip) {
            console.error("[Editor] Failed to create dynamic Fall Backward Clip.");
            return;
        }

        // REPLACE the clip associated with the existing action state
        const oldAction = fallBackwardAction;
        const oldClip = oldAction.getClip();

        oldAction.stop();
        mixer.uncacheAction(oldClip, oldAction.getRoot());
        mixer.uncacheClip(oldClip);

        const newAction = mixer.clipAction(newFallClip);
        newAction.setLoop(THREE.LoopOnce, 1);
        newAction.clampWhenFinished = true;

        setFallBackwardAction(newAction); // Update state

        console.log("[Editor] Triggering Fall Backward with updated clip/action...");
        setIsPlaying(true); 
        setCurrentPoseState('falling'); // New state: 'falling'
        setAutoRotate(false);

        // Stop all other actions cleanly using fades
        resetPoseAction?.fadeOut(0.2);
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2);
        walkCycleAction?.fadeOut(0.2);
        rightPunchAction?.fadeOut(0.2);
        leftPunchAction?.fadeOut(0.2);
        blockPoseAction?.fadeOut(0.2);
        duckPoseAction?.fadeOut(0.2);
        duckKickAction?.fadeOut(0.2); 
        transitionToHelloAction?.fadeOut(0.2);
        helloWaveLoopAction?.fadeOut(0.2);
        transitionToArmsCrossedAction?.fadeOut(0.2);
        armsCrossedBreathAction?.fadeOut(0.2);
        bowAction?.fadeOut(0.2);

        // Play the NEW action
        newAction.reset().fadeIn(0.2).play();

    }, [
        skeleton, 
        mixer, 
        initialPose, 
        // Actions to check/fade out
        resetPoseAction, 
        fightStanceAction, 
        idleBreathAction, 
        walkCycleAction, 
        rightPunchAction, 
        leftPunchAction, 
        blockPoseAction, 
        duckPoseAction, 
        duckKickAction, 
        transitionToHelloAction, 
        helloWaveLoopAction, 
        transitionToArmsCrossedAction, 
        armsCrossedBreathAction, 
        bowAction, 
        fallBackwardAction, // Include the state variable itself
        // State setters
        setFallBackwardAction, 
        setAutoRotate, 
        setIsPlaying, 
        setCurrentPoseState
    ]);

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
            <Leva 
                collapsed={false} 
                theme={{ sizes: { rootWidth: '330px' } }} // Set panel width 
            />
             {/* Main div needs h-screen or similar to contain Canvas */}
            <div className="relative w-full h-screen bg-gradient-to-br from-arcade-dark-gray to-arcade-bg">
                 <div className="absolute top-4 left-4 z-10 bg-black/50 p-2 rounded">
                     <h1 className="text-2xl sm:text-3xl font-bold text-logo-yellow drop-shadow-[2px_2px_0_rgba(0,0,0,0.8)]">
                        Pose Editor: {characterName}
                    </h1>
                 </div>
                <div className="absolute top-24 left-4 z-10 flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-10rem)] pr-2">
                    {/* Reset Button: Disable only if action unavailable or currently playing another blocking anim */}
                     <button onClick={triggerResetPose} disabled={!resetPoseAction || isPlaying} className={`btn-arcade ${(!resetPoseAction || isPlaying) ? "btn-arcade-disabled" : "btn-arcade-primary"}`}>
                         Reset Pose
                    </button>
                    {/* Fight Stance Button: Disable if action unavailable or currently playing another blocking anim */}
                    <button onClick={triggerFightStance} disabled={!fightStanceAction || isPlaying} className={`btn-arcade ${(!fightStanceAction || isPlaying) ? "btn-arcade-disabled" : "btn-arcade-secondary"}`}>
                        Go to Fight Stance
                    </button>
                    {/* Walk Cycle Button: Disable if action unavailable or currently playing a blocking anim */}
                    <button onClick={triggerWalkCycle} disabled={!walkCycleAction || isPlaying} className={`btn-arcade ${(!walkCycleAction || isPlaying) ? "btn-arcade-disabled" : "btn-arcade-action"}`}>
                        Walk Cycle
                    </button>
                    {/* Punch Button: Disable if action unavailable or currently playing another blocking anim */}
                    <button onClick={triggerRightPunch} disabled={!rightPunchAction || isPlaying} className={`btn-arcade ${(!rightPunchAction || isPlaying) ? "btn-arcade-disabled" : "btn-arcade-attack"}`}>
                        Right Punch
                    </button>
                    {/* Left Punch Button: Disable if action unavailable or currently playing another blocking anim */}
                    <button onClick={triggerLeftPunch} disabled={!leftPunchAction || isPlaying} className={`btn-arcade ${(!leftPunchAction || isPlaying) ? "btn-arcade-disabled" : "btn-arcade-attack"}`}>
                        Left Punch
                    </button>
                    {/* Block Button: Disable if action unavailable or currently playing another blocking anim */}
                    <button onClick={triggerBlockPose} disabled={!blockPoseAction || isPlaying} className={`btn-arcade ${(!blockPoseAction || isPlaying) ? "btn-arcade-disabled" : "btn-arcade-defense"}`}>
                        Block
                    </button>
                    {/* Duck Button: Disable if action unavailable or currently playing another blocking anim */}
                    <button onClick={triggerDuckPose} disabled={!duckPoseAction || isPlaying} className={`btn-arcade ${(!duckPoseAction || isPlaying) ? "btn-arcade-disabled" : "btn-arcade-movement"}`}>
                        Duck
                    </button>
                    {/* Duck Kick Button: Enable only if duck kick action exists AND character is currently ducking AND no other blocking anim is playing */} 
                    <button onClick={triggerDuckKick} disabled={!duckKickAction || currentPoseState !== 'ducking' || isPlaying} className={`btn-arcade ${(!duckKickAction || currentPoseState !== 'ducking' || isPlaying) ? "btn-arcade-disabled" : "btn-arcade-attack"}`}>
                        Duck Kick
                    </button>
                      {/* Hello Button: Disable if actions unavailable or currently playing a blocking anim (transition) */}
                      <button onClick={triggerHello} disabled={!transitionToHelloAction || !helloWaveLoopAction || isPlaying} className={`btn-arcade ${(!transitionToHelloAction || !helloWaveLoopAction || isPlaying) ? "btn-arcade-disabled" : "btn-arcade-emote"}`}>
                        Hello Wave
                    </button>
                    {/* Arms Crossed Button: Disable if actions unavailable or currently playing a blocking anim */}
                    <button onClick={triggerArmsCrossed} disabled={!transitionToArmsCrossedAction || !armsCrossedBreathAction || isPlaying} className={`btn-arcade ${(!transitionToArmsCrossedAction || !armsCrossedBreathAction || isPlaying) ? "btn-arcade-disabled" : "btn-arcade-stance"}`}>
                        Arms Crossed
                    </button>
                    {/* Bow Button: Disable if action unavailable or currently playing a blocking anim */}
                    <button onClick={triggerBow} disabled={!bowAction || isPlaying} className={`btn-arcade ${(!bowAction || isPlaying) ? "btn-arcade-disabled" : "btn-arcade-emote"}`}>
                        Bow
                    </button>
                    {/* Fall Backward Button: Disable if action unavailable or currently playing another blocking anim */}
                    <button onClick={triggerFallBackward} disabled={!fallBackwardAction || isPlaying} className={`btn-arcade ${(!fallBackwardAction || isPlaying) ? "btn-arcade-disabled" : "btn-arcade-danger"}`}>
                         Fall Backward
                    </button>
                </div>
                <Canvas camera={{ position: [0, 0.5, 1.8], fov: 60 }} shadows >
                    <ambientLight intensity={0.7} />
                    <directionalLight position={[5, 10, 5]} intensity={1.0} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
                    <hemisphereLight intensity={0.4} groundColor="#555" /> {/* Re-add hemisphereLight */}
                    <Suspense fallback={ <Html center> <p className="text-arcade-yellow text-xl animate-pulse">Loading Model...</p> </Html> }>
                        <Model url={modelUrl!} setAutoRotate={setAutoRotate} setMixer={setMixer} setInitialPose={setInitialPose} setSkeleton={setSkeleton} />
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
    // Removed debugging log logic
    useFrame((_, delta) => { 
        mixer?.update(delta); 
    });
    return null;
}

// --- createResetPoseClip Function (Remove local definition) ---
// Ensure the following function definition is removed as it's now imported
/*
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
*/ 