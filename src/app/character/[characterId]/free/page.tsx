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
    defaultFightStanceTargets,
    blockTargets
} from '@/lib/animations/clips';

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
    const [fightStanceAction, setFightStanceAction] = useState<THREE.AnimationAction | null>(null);
    const [idleBreathAction, setIdleBreathAction] = useState<THREE.AnimationAction | null>(null);
    const [walkCycleAction, setWalkCycleAction] = useState<THREE.AnimationAction | null>(null);
    const [rightPunchAction, setRightPunchAction] = useState<THREE.AnimationAction | null>(null);
    const [blockPoseAction, setBlockPoseAction] = useState<THREE.AnimationAction | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
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
             let createdReset = false, createdStance = false, createdIdle = false, createdWalk = false, createdPunch = false, createdBlock = false;
             
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
                     createdPunch = true;
                      console.log("[Editor] Right Punch Action created.");
                 } else { console.error("[Editor] Failed to create Right Punch Clip/Action."); }
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

        } else {
             // Clear actions if mixer/skeleton/pose become unavailable
             if (resetPoseAction) { resetPoseAction.stop(); setResetPoseAction(null); }
             if (fightStanceAction) { fightStanceAction.stop(); setFightStanceAction(null); }
             if (idleBreathAction) { idleBreathAction.stop(); setIdleBreathAction(null); }
             if (walkCycleAction) { walkCycleAction.stop(); setWalkCycleAction(null); }
             if (rightPunchAction) { rightPunchAction.stop(); setRightPunchAction(null); }
             if (blockPoseAction) { blockPoseAction.stop(); setBlockPoseAction(null); }
             setIsPlaying(false); // Reset playing state
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
    }, [mixer, skeleton, initialPose, resetPoseAction, fightStanceAction, idleBreathAction, walkCycleAction, rightPunchAction, blockPoseAction]); 
    
    // --- Setup Animation Listener --- // Handles transitions after animations finish
    useEffect(() => {
        if (!mixer || !idleBreathAction) return; // Need idle action too for transitions

        const onAnimationFinished = (event: AnimationFinishedEvent) => {
            // Use the STATE variables here for reliable checks
            if (fightStanceAction && event.action === fightStanceAction) {
                console.log("[Editor] Fight Stance Finished. Starting Idle Breath.");
                // Check if another action hasn't already started
                if (idleBreathAction.weight === 0) { // Only transition if idle isn't already fading in/active
                   idleBreathAction.reset().fadeIn(0.3).play();
                   // Don't set isPlaying here, idle allows interaction
                } 
            } else if (resetPoseAction && event.action === resetPoseAction) {
                console.log("[Editor] Reset Pose Finished.");
                setIsPlaying(false); // Animation sequence complete
                setAutoRotate(true); // Re-enable auto-rotate
            } else if (rightPunchAction && event.action === rightPunchAction) {
                console.log("[Editor] Right Punch Finished. Starting Idle Breath.");
                // Check if another action hasn't already started
                if (idleBreathAction.weight === 0) { // Only transition if idle isn't already fading in/active
                    idleBreathAction.reset().fadeIn(0.3).play();
                }
                // Punch finished, allow leva interaction even if no idle plays
                setIsPlaying(false); // Punch sequence finished
            } else if (blockPoseAction && event.action === blockPoseAction) {
                console.log("[Editor] Block Pose Finished. Holding pose.");
                // We have clamped at the end, so just allow interaction
                setIsPlaying(false); // Block transition finished
            }
        };

        mixer.addEventListener('finished', onAnimationFinished);
        console.log("[Editor] Added 'finished' listener.");

        // Ensure listener has access to the latest actions and state setters
    }, [mixer, fightStanceAction, resetPoseAction, idleBreathAction, rightPunchAction, blockPoseAction, setAutoRotate, setIsPlaying]); // Added blockPoseAction

    // --- Live Update Pose (Keep definition) ---
    useEffect(() => {
        if (!skeleton || Object.keys(initialPose).length === 0 || !levaInitialized || isPlaying) return; // Skip direct updates if animating
        
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
    }, [levaControls, skeleton, initialPose, setAutoRotate, levaInitialized, isPlaying]);
    
    // --- Reset Pose Handler (Update for fades and state) ---
    const triggerResetPose = useCallback(() => {
        // Use state variables for checks
        if (!resetPoseAction || !mixer) return; // Simpler check
        console.log("[Editor] Triggering Reset Pose...");
        setIsPlaying(true); // Reset IS a blocking action
        setAutoRotate(false); // Keep off until reset finishes via the listener

        // Stop other actions cleanly using fades
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2);
        walkCycleAction?.fadeOut(0.2);
        rightPunchAction?.fadeOut(0.2);
        blockPoseAction?.fadeOut(0.2);

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

    }, [resetPoseAction, fightStanceAction, idleBreathAction, walkCycleAction, rightPunchAction, blockPoseAction, mixer, setAutoRotate, initialPose, skeleton, setLevaControls, setIsPlaying]); // Added blockPoseAction

    // --- Fight Stance Handler (Update for fades and state) ---
    const triggerFightStance = useCallback(() => {
        // Use state variables for checks
        if (!fightStanceAction || !mixer) return; // Simpler check
        console.log("[Editor] Triggering Fight Stance Sequence...");
        setIsPlaying(true); // Stance transition IS a blocking action
        setAutoRotate(false);
        
        // Stop other actions cleanly using fades
        resetPoseAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2); // Fade out idle if it was playing
        walkCycleAction?.fadeOut(0.2); // Stop walk if playing
        rightPunchAction?.fadeOut(0.2); // Stop punch if playing
        blockPoseAction?.fadeOut(0.2); // Stop block if active
        
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

    }, [fightStanceAction, resetPoseAction, idleBreathAction, walkCycleAction, rightPunchAction, blockPoseAction, mixer, setAutoRotate, initialPose, skeleton, setLevaControls, setIsPlaying]); // Added blockPoseAction

    // --- Walk Cycle Handler ---
    const triggerWalkCycle = useCallback(() => {
        if (!walkCycleAction || !mixer) return;
        console.log("[Editor] Triggering Walk Cycle...");
        setIsPlaying(false); // Ensure Leva is enabled during walk
        setAutoRotate(false);

        // Stop other actions cleanly using fades
        resetPoseAction?.fadeOut(0.2);
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2);
        rightPunchAction?.fadeOut(0.2);
        blockPoseAction?.fadeOut(0.2);

        // Play walk cycle with fade in (loops)
        walkCycleAction.reset().fadeIn(0.2).play();

        // DO NOT update Leva controls for walk cycle

    }, [walkCycleAction, resetPoseAction, fightStanceAction, idleBreathAction, rightPunchAction, blockPoseAction, mixer, setAutoRotate, setIsPlaying]); // Added blockPoseAction

    // --- Right Punch Handler ---
    const triggerRightPunch = useCallback(() => {
        if (!rightPunchAction || !mixer) return;
        console.log("[Editor] Triggering Right Punch...");
        setIsPlaying(true); // Punch IS a blocking action
        setAutoRotate(false);

        // Stop other actions cleanly using fades
        resetPoseAction?.fadeOut(0.2);
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2);
        walkCycleAction?.fadeOut(0.2);
        blockPoseAction?.fadeOut(0.2);

        // Play punch animation with fade in (plays once)
        rightPunchAction.reset().fadeIn(0.2).play();

        // DO NOT update Leva controls for punch

    }, [rightPunchAction, resetPoseAction, fightStanceAction, idleBreathAction, walkCycleAction, blockPoseAction, mixer, setAutoRotate, setIsPlaying]); // Added blockPoseAction

    // --- Block Pose Handler ---
    const triggerBlockPose = useCallback(() => {
        if (!blockPoseAction || !mixer) return;
        console.log("[Editor] Triggering Block Pose...");
        setIsPlaying(true); // Block transition IS a blocking action
        setAutoRotate(false);

        // Stop other actions cleanly using fades
        resetPoseAction?.fadeOut(0.2);
        fightStanceAction?.fadeOut(0.2);
        idleBreathAction?.fadeOut(0.2);
        walkCycleAction?.fadeOut(0.2);
        rightPunchAction?.fadeOut(0.2);

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

    }, [blockPoseAction, resetPoseAction, fightStanceAction, idleBreathAction, walkCycleAction, rightPunchAction, mixer, setAutoRotate, setIsPlaying, setLevaControls]); // Dependencies remain similar

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
                    {/* Reset Button: Disable only if action unavailable */}
                    <button onClick={triggerResetPose} disabled={!resetPoseAction} className={`btn-arcade ${!resetPoseAction ? "btn-arcade-disabled" : "btn-arcade-primary"}`}>
                        Reset Pose
                    </button>
                    {/* Fight Stance Button: Disable if action unavailable or during Reset/Punch */}
                    <button onClick={triggerFightStance} disabled={!fightStanceAction || (isPlaying && rightPunchAction?.isRunning()) || (isPlaying && resetPoseAction?.isRunning())} className={`btn-arcade ${(!fightStanceAction || (isPlaying && rightPunchAction?.isRunning()) || (isPlaying && resetPoseAction?.isRunning())) ? "btn-arcade-disabled" : "btn-arcade-secondary"}`}>
                        Go to Fight Stance
                    </button>
                    {/* Walk Cycle Button: Disable if action unavailable or during Reset/Punch */}
                    <button onClick={triggerWalkCycle} disabled={!walkCycleAction || (isPlaying && rightPunchAction?.isRunning()) || (isPlaying && resetPoseAction?.isRunning())} className={`btn-arcade ${(!walkCycleAction || (isPlaying && rightPunchAction?.isRunning()) || (isPlaying && resetPoseAction?.isRunning())) ? "btn-arcade-disabled" : "btn-arcade-action"}`}>
                        Walk Cycle
                    </button>
                    {/* Punch Button: Disable if action unavailable or during Reset */}
                    <button onClick={triggerRightPunch} disabled={!rightPunchAction || (isPlaying && resetPoseAction?.isRunning())} className={`btn-arcade ${(!rightPunchAction || (isPlaying && resetPoseAction?.isRunning())) ? "btn-arcade-disabled" : "btn-arcade-attack"}`}>
                        Right Punch
                    </button>
                    {/* Add Block Button */}
                    <button onClick={triggerBlockPose} disabled={!blockPoseAction} className={`btn-arcade ${(!blockPoseAction) ? "btn-arcade-disabled" : "btn-arcade-defense"}`}>
                        Block
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