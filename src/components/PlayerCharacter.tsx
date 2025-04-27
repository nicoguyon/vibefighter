import React, { useEffect, useState, useRef, memo, useMemo, forwardRef, useCallback, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
// import { useBox, type BoxProps, type BodyProps } from '@react-three/cannon'; // Keep commented
// Remove Rapier imports

// Import animation types and functions
import {
    createWalkCycleClip,
    createFightStanceClip,
    createIdleBreathClip,
    createRightPunchClip,
    createLeftPunchClip,
    createDuckPoseClip,
    createBlockPoseClip,
    createDuckKickClip,
    // --- NEW: Intro Animation Imports ---
    createTransitionToHelloClip,
    createHelloWaveLoopClip,
    createTransitionToArmsCrossedClip,
    createArmsCrossedBreathClip,
    createBowClip,
    createFallBackwardClip,
    // --- Target Pose Imports ---
    defaultFightStanceTargets,
    blockTargets,
    helloTargets,
    armsCrossedTargets,
    // --- Type Imports ---
    type InitialPoseData,
    type EulerOrder,
    type StartPose
} from '../lib/animations/clips';


// --- NEW: Export Fight Phase Type ---
export type FightPhase = 'LOADING' | 'INTRO_START' | 'INTRO_P1' | 'INTRO_P2' | 'PRE_FIGHT' | 'READY' | 'FIGHT' | 'GAME_OVER';


// --- Define Input State Type ---
export type InputState = {
    left: boolean;
    right: boolean;
    punch: boolean;
    duck: boolean;
    block: boolean;
    jump: boolean;
};

// Export the handle type directly here
export interface PlayerCharacterHandle {
    getMainGroup: () => THREE.Group | null;
    getModelWrapper: () => THREE.Group | null;
    setPositionX: (x: number) => void;
    resetVelocityX: () => void;
    getHasHitGround: () => boolean;
    isAttacking: () => boolean;
    isDucking: () => boolean;
    confirmHit: () => void;
    getCanDamage: () => boolean;
    isBlocking: () => boolean;
}

// --- Types ---
interface PlayerCharacterProps {
    modelUrl: string;
    initialPosition: [number, number, number];
    initialFacing: 'left' | 'right';
    isPlayerControlled: boolean;
    fightPhase: FightPhase;
    introAnimationType: string | null;
    startIntroAnimation: boolean;
    canFight: boolean;
    externalInput?: React.RefObject<InputState>;
    onCharacterReady?: () => void;
    currentHealth: number;
}

interface AnimationFinishedEvent extends THREE.Event {
    type: 'finished';
    action: THREE.AnimationAction;
    direction: number;
}


// --- Constants ---
const CHARACTER_WALK_SPEED = 2;
const GRAVITY = 9.81 * 2;
const JUMP_FORCE = 7;
const JUMP_HORIZONTAL_SPEED = 1.8; // Speed for forward/backward jumps
const GROUND_LEVEL = 0;
// Debug Collider Visuals (Adjusted Size)
const DEBUG_CYLINDER_HEIGHT = 1; // Slightly shorter
const DEBUG_CYLINDER_RADIUS = 0.09; // Significantly narrower
// --- ADDED: Boundary Constants (copied from BattleScene) ---
const MIN_X = -8;
const MAX_X = 8;

// Define available animation types FOR VICTORY (Transitions Only for now)
const VICTORY_ANIMATION_TYPES = ['Hello', 'ArmsCrossed', 'Bow']; // Use for victory poses

// Helper function to pick a random intro animation
const getRandomVictoryAnimation = () => VICTORY_ANIMATION_TYPES[Math.floor(Math.random() * VICTORY_ANIMATION_TYPES.length)];

// --- Component Definition with forwardRef ---
export const PlayerCharacter = memo(forwardRef<PlayerCharacterHandle, PlayerCharacterProps>(
    (props, ref): React.ReactNode => {
        // Destructure props inside the function body
        const {
            modelUrl,
            initialPosition,
            initialFacing,
            isPlayerControlled,
            fightPhase,
            introAnimationType,
            startIntroAnimation,
            canFight,
            externalInput,
            onCharacterReady,
            currentHealth,
        } = props;

        // --- Refs ---
        const groupRef = useRef<THREE.Group>(null);
        const modelWrapperRef = useRef<THREE.Group>(null);
        const mainGroupRefCallback = useCallback((node: THREE.Group | null) => {
            groupRef.current = node;
        }, []);

        // Action/State Refs
        const isAttackingRef = useRef(false);
        const canDamageRef = useRef(false);
        const isBlockingRef = useRef(false);
        const isDuckingRef = useRef(false);
        const manualVelocityRef = useRef({ x: 0, y: 0, z: 0 });
        const positionRef = useRef(new THREE.Vector3(...initialPosition));
        const skeletonRef = useRef<THREE.Skeleton | null>(null);
        const isMovingHorizontally = useRef(false);
        const hasHitGround = useRef(false);
        const isInStance = useRef(false);
        const isActionInProgress = useRef(false);
        const currentIntroLoopAction = useRef<THREE.AnimationAction | null>(null);
        const isReadySignaled = useRef(false);
        const nextPunchTypeRef = useRef<'right' | 'left'>('right'); // <-- Use useRef to track next punch type
        const [idleBreathAction, setIdleBreathAction] = useState<THREE.AnimationAction | null>(null); 
        const [audioPlayed, setAudioPlayed] = useState(false); // Track audio playback
        const [fallBackwardAction, setFallBackwardAction] = useState<THREE.AnimationAction | null>(null); // <-- ADD State for Fall Action
        const punchIntervalRef = useRef<NodeJS.Timeout | null>(null); // Ref for punch interval timer
        const stanceTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref for initial stance delay timeout
        // Add refs specifically for winner rotation control
        const winnerRotationTarget = useRef<number | null>(null);
        const winnerRotationComplete = useRef(false);
        const victoryAnimPlayed = useRef(false); // To ensure anim plays only once

        // --- Effect to synchronize positionRef with prop ---
        useEffect(() => {
            console.log(`[PlayerCharacter ${initialFacing}] initialPosition prop updated:`, initialPosition);
            positionRef.current.set(...initialPosition);
            console.log(`[PlayerCharacter ${initialFacing}] positionRef updated to:`, positionRef.current);
            // Reset ground/velocity state when position changes drastically (like on navigation)
            hasHitGround.current = false;
            manualVelocityRef.current = { x: 0, y: 0, z: 0 };
        }, [initialPosition]);

        // --- useImperativeHandle ---
        useImperativeHandle(ref, () => ({ 
            getMainGroup: () => groupRef.current,
            getModelWrapper: () => modelWrapperRef.current,
            setPositionX: (x: number) => {
                if (positionRef.current) {
                    positionRef.current.x = x;
                }
            },
            resetVelocityX: () => {
                if (manualVelocityRef.current) {
                    manualVelocityRef.current.x = 0;
                }
            },
            getHasHitGround: () => hasHitGround.current,
            isAttacking: () => isAttackingRef.current,
            isDucking: () => isDuckingRef.current,
            confirmHit: () => { 
                canDamageRef.current = false; 
            },
            getCanDamage: () => canDamageRef.current,
            isBlocking: () => isBlockingRef.current
        }), [isAttackingRef, canDamageRef, isBlockingRef, isDuckingRef]);

        // --- State ---
        const [pressedKeys, setPressedKeys] = useState<InputState>({
            left: false,
            right: false,
            punch: false,
            duck: false,
            block: false,
            jump: false,
        });
        const [isLoaded, setIsLoaded] = useState(false);
        const [initialPose, setInitialPose] = useState<Record<string, InitialPoseData>>({});

        // --- Load Model & Capture Skeleton/Pose ---
        const { scene } = useGLTF(modelUrl);
        useEffect(() => {
            if (scene && !skeletonRef.current) { 
                let foundSkeleton: THREE.Skeleton | null = null;
                const pose: Record<string, InitialPoseData> = {};
                scene.traverse((child) => {
                    if (child instanceof THREE.SkinnedMesh && !foundSkeleton) {
                        if (child.skeleton) {
                             foundSkeleton = child.skeleton;
                        }
                    }
                });

                if (foundSkeleton) {
                    skeletonRef.current = foundSkeleton;
                    // @ts-ignore 
                    foundSkeleton.bones.forEach((bone: THREE.Bone) => {
                        const boneName: string = bone.name;
                        pose[boneName] = {
                            pos: bone.position.clone(),
                            quat: bone.quaternion.clone(),
                            scale: bone.scale.clone()
                        };
                    });
                    setInitialPose(pose);
                } else {
                    console.warn("Could not find skeleton in the model.");
                }
                setIsLoaded(true);
            } 
        }, [scene]);

        // Define key handlers outside useEffect so they can be referenced in cleanup
        const handleKeyDown = useCallback((event: KeyboardEvent) => {
             switch (event.key) {
                 case 'ArrowLeft': setPressedKeys(prev => ({ ...prev, left: true })); break;
                 case 'ArrowRight': setPressedKeys(prev => ({ ...prev, right: true })); break;
                 case 'ArrowDown': setPressedKeys(prev => ({ ...prev, duck: true })); break;
                 case ' ': setPressedKeys(prev => ({ ...prev, punch: true })); break;
                 case 'b': setPressedKeys(prev => ({ ...prev, block: true })); break;
                 case 'ArrowUp': setPressedKeys(prev => ({ ...prev, jump: true })); break;
             }
        }, []);

        const handleKeyUp = useCallback((event: KeyboardEvent) => {
              switch (event.key) {
                 case 'ArrowLeft': setPressedKeys(prev => ({ ...prev, left: false })); break;
                 case 'ArrowRight': setPressedKeys(prev => ({ ...prev, right: false })); break;
                 case 'ArrowDown': setPressedKeys(prev => ({ ...prev, duck: false })); break;
                 case ' ': setPressedKeys(prev => ({ ...prev, punch: false })); break;
                 case 'b': setPressedKeys(prev => ({ ...prev, block: false })); break;
                 case 'ArrowUp': setPressedKeys(prev => ({ ...prev, jump: false })); break;
             }
        }, []);

        // --- Input Handling (Conditionally Active) ---
        useEffect(() => {
            if (!isPlayerControlled || externalInput || !canFight) { // <--- ADDED !canFight check
                 // If listeners were previously attached, remove them
                 window.removeEventListener('keydown', handleKeyDown);
                 window.removeEventListener('keyup', handleKeyUp);
                 return; // Don't attach listeners if not player controlled or fight hasn't started
            }

            window.addEventListener('keydown', handleKeyDown);
            window.addEventListener('keyup', handleKeyUp);
            return () => {
                window.removeEventListener('keydown', handleKeyDown);
                window.removeEventListener('keyup', handleKeyUp);
            };
             // Add canFight to dependency array to re-evaluate listener attachment
        }, [isPlayerControlled, externalInput, canFight, handleKeyDown, handleKeyUp]); // Add handlers to dependencies


        // --- Helper to get the current effective input state ---
        const getEffectiveInputState = useCallback((): InputState => {
            // Return empty state if fight hasn't started
            if (!canFight) {
                return { left: false, right: false, punch: false, duck: false, block: false, jump: false };
            }
            if (externalInput?.current) {
                return externalInput.current;
            }
            return pressedKeys;
        }, [externalInput, pressedKeys, canFight]); // Add canFight dependency


        // --- Create Animation Clips ---
        const walkCycleClip = useMemo(() => createWalkCycleClip(skeletonRef.current, initialPose, defaultFightStanceTargets, 'WalkCycle', 0.7), [initialPose]);
        const fightStanceClip = useMemo(() => createFightStanceClip(skeletonRef.current, initialPose, defaultFightStanceTargets, 'GoToFightStance'), [initialPose]);
        const idleBreathClip = useMemo(() => createIdleBreathClip(skeletonRef.current, defaultFightStanceTargets, initialPose), [initialPose]);
        const duckPoseClip = useMemo(() => createDuckPoseClip(skeletonRef.current, initialPose, defaultFightStanceTargets), [initialPose]);
        const blockPoseClip = useMemo(() => createBlockPoseClip(skeletonRef.current, initialPose, defaultFightStanceTargets), [initialPose]);
        const duckKickClip = useMemo(() => createDuckKickClip(skeletonRef.current, initialPose), [initialPose]);
        const fallBackwardClip = useMemo(() => createFallBackwardClip(skeletonRef.current, initialPose), [initialPose]);

        // --- NEW: Intro Animation Clips ---
        const transitionToHelloClip = useMemo(() => skeletonRef.current && initialPose ? createTransitionToHelloClip(skeletonRef.current, initialPose, helloTargets) : null, [initialPose]);
        const helloWaveLoopClip = useMemo(() => skeletonRef.current && initialPose ? createHelloWaveLoopClip(skeletonRef.current, initialPose, helloTargets) : null, [initialPose]);
        const transitionToArmsCrossedClip = useMemo(() => skeletonRef.current && initialPose ? createTransitionToArmsCrossedClip(skeletonRef.current, initialPose, armsCrossedTargets) : null, [initialPose]);
        const armsCrossedBreathClip = useMemo(() => skeletonRef.current && initialPose ? createArmsCrossedBreathClip(skeletonRef.current, armsCrossedTargets, initialPose) : null, [initialPose]);
        const bowClip = useMemo(() => skeletonRef.current && initialPose ? createBowClip(skeletonRef.current, initialPose) : null, [initialPose]);


        // --- Setup Animation Actions ---
        const animationsToUse = useMemo(() => {
            const clips = [
                walkCycleClip, fightStanceClip, idleBreathClip,
                duckPoseClip, blockPoseClip, duckKickClip,
                fallBackwardClip,
                // Add intro/victory transitions and loops
                transitionToHelloClip, helloWaveLoopClip,
                transitionToArmsCrossedClip, armsCrossedBreathClip,
                bowClip
            ].filter(Boolean);
            // @ts-ignore
            return clips as THREE.AnimationClip[];
        }, [
            walkCycleClip, fightStanceClip, idleBreathClip,
            duckPoseClip, blockPoseClip, duckKickClip,
            fallBackwardClip,
            transitionToHelloClip, helloWaveLoopClip,
            transitionToArmsCrossedClip, armsCrossedBreathClip,
            bowClip
        ]);
        const { actions, mixer } = useAnimations(animationsToUse, groupRef);

        // --- Configure Animation Actions & Initial State + Signal Readiness ---
        useEffect(() => {
             if (!actions || !mixer || !isLoaded || !onCharacterReady) { // Check essential dependencies
                 console.log(`[PlayerCharacter ${initialFacing} Anims] Waiting for actions/mixer/load/callback...`);
                 return;
             }

             console.log(`[PlayerCharacter ${initialFacing} Anims] Configuring actions.`);
             if (actions?.WalkCycle) actions.WalkCycle.setLoop(THREE.LoopRepeat, Infinity);
             if (actions?.GoToFightStance) { actions.GoToFightStance.setLoop(THREE.LoopOnce, 1); actions.GoToFightStance.clampWhenFinished = true; }
             if (actions?.IdleBreath) actions.IdleBreath.setLoop(THREE.LoopRepeat, Infinity);
             if (actions?.DuckPose) { actions.DuckPose.setLoop(THREE.LoopOnce, 1); actions.DuckPose.clampWhenFinished = true; }
             if (actions?.BlockPose) { actions.BlockPose.setLoop(THREE.LoopOnce, 1); actions.BlockPose.clampWhenFinished = true; }
             if (actions?.DuckKick) { actions.DuckKick.setLoop(THREE.LoopOnce, 1); actions.DuckKick.clampWhenFinished = true; }
             if (actions?.TransitionToHello) { actions.TransitionToHello.setLoop(THREE.LoopOnce, 1); actions.TransitionToHello.clampWhenFinished = true; }
             if (actions?.HelloWaveLoop) { actions.HelloWaveLoop.setLoop(THREE.LoopRepeat, Infinity); }
             if (actions?.TransitionToArmsCrossed) { actions.TransitionToArmsCrossed.setLoop(THREE.LoopOnce, 1); actions.TransitionToArmsCrossed.clampWhenFinished = true; }
             if (actions?.ArmsCrossedBreath) { actions.ArmsCrossedBreath.setLoop(THREE.LoopRepeat, Infinity); }
             if (actions?.Bow) { actions.Bow.setLoop(THREE.LoopOnce, 1); actions.Bow.clampWhenFinished = true; }
             if (actions?.FallBackward) {
                 actions.FallBackward.setLoop(THREE.LoopOnce, 1);
                 actions.FallBackward.clampWhenFinished = true;
                 setFallBackwardAction(actions.FallBackward);
             }

             if (mixer) mixer.timeScale = 1;

             console.log(`[PlayerCharacter ${initialFacing} Anims] Initial setup complete.`);
             isInStance.current = false;

             // --- Signal Readiness --- 
             if (!isReadySignaled.current) {
                 console.log(`[PlayerCharacter ${initialFacing}] Signaling Ready!`);
                 onCharacterReady(); // Call the passed callback
                 isReadySignaled.current = true;
             }

        }, [actions, mixer, isLoaded, onCharacterReady, initialFacing]);


        // --- MOVE THESE DEFINITIONS UP ---

        const triggerDuck = useCallback(() => {
            if (!actions?.DuckPose || !mixer) return; // Added mixer check

            // Only trigger if not already ducking or performing another blocking action
            if (isDuckingRef.current || isActionInProgress.current) {
                // console.log(`[PlayerCharacter ${initialFacing}] Duck trigger ignored: Already ducking or action in progress.`);
                 return;
            }
             console.log(`[PlayerCharacter ${initialFacing}] Triggering Duck`);
            isActionInProgress.current = true;
            isDuckingRef.current = true;

            // --- FORCE STOP other actions instead of fading ---
            console.log(`[PlayerCharacter ${initialFacing}] Stopping potentially active actions before ducking.`);
            mixer.stopAllAction(); // Stop everything first
            // actions.IdleBreath?.fadeOut(0.1);
            // actions.WalkCycle?.fadeOut(0.1);
            // actions.RightPunch?.fadeOut(0.1); // Should already be stopped by isActionInProgress check, but belt-and-suspenders
            // actions.BlockPose?.fadeOut(0.1); // Should already be stopped
            // actions.DuckKick?.fadeOut(0.1); // Should already be stopped
            // --- End Change ---
            
            // Now play the duck pose
            actions.DuckPose.reset().fadeIn(0.2).play(); // Keep the fade-in for smoothness

         }, [actions, mixer, isDuckingRef, isActionInProgress, initialFacing]);

         // Define triggerDuck dependency here explicitly for clarity if needed
         const triggerDuckDep = triggerDuck; 

        const triggerBlock = useCallback(() => {
            if (!actions?.BlockPose) return;
            console.log(`[PlayerCharacter ${initialFacing}] Triggering Block`);
            isActionInProgress.current = true;
            isBlockingRef.current = true;
            isDuckingRef.current = false; // Stop ducking when blocking
            actions.IdleBreath?.fadeOut(0.1);
            actions.WalkCycle?.fadeOut(0.1);
            actions.RightPunch?.fadeOut(0.1);
            actions.DuckPose?.fadeOut(0.1); // Fade out duck if active
            actions.DuckKick?.fadeOut(0.1);
            actions.BlockPose.reset().fadeIn(0.2).play();
        }, [actions, initialFacing]);

        const stopBlock = useCallback(() => {
            if (!actions?.BlockPose) return;
            console.log(`[PlayerCharacter ${initialFacing}] Stopping Block`);
            isActionInProgress.current = true;
            actions.BlockPose.fadeOut(0.2);
            isBlockingRef.current = false;
            setTimeout(() => {
                isActionInProgress.current = false;
                const currentInput = getEffectiveInputState();
                if (currentInput.duck && !isDuckingRef.current) {
                     triggerDuckDep(); // Call the dependency-managed version
                 } else if (isInStance.current && !isMovingHorizontally.current && !currentInput.duck) {
                     // Check if idleAction exists before using it
                     if(actions?.IdleBreath) {
                        actions.IdleBreath.reset().fadeIn(0.3).play();
                     }
                }
            }, 200);
        }, [actions, getEffectiveInputState, isInStance, initialFacing, triggerDuckDep]); // Use triggerDuckDep

        const triggerStandUp = useCallback(() => {
            const duckAction = actions?.DuckPose;
            const stanceAction = actions?.GoToFightStance; // Get stance action
            if (!duckAction || !stanceAction || !isDuckingRef.current) { // Check stance action exists
                console.warn(`[PlayerCharacter ${initialFacing}] Stand Up prerequisites missing (duckAction=${!!duckAction}, stanceAction=${!!stanceAction}, isDucking=${isDuckingRef.current})`);
                return;
            }

            console.log(`[PlayerCharacter ${initialFacing}] Triggering Stand Up (New Logic: Play Stance)`);
            isActionInProgress.current = true;
            isDuckingRef.current = false; // No longer ducking
            
            // 1. Fade out ducking pose
            duckAction.fadeOut(0.2);

            // 2. Play the transition to stance immediately after starting fade out
            stanceAction.reset().fadeIn(0.1).play(); // Short fade in for smoothness

            // 3. Set state and potentially play idle *after* stance transition finishes
            const stanceDuration = stanceAction.getClip().duration;
            const delay = (stanceDuration + 0.1) * 1000; // Delay slightly longer than stance duration

            // Clear previous timeout if any (belt-and-suspenders)
            if (stanceTimeoutRef.current) clearTimeout(stanceTimeoutRef.current);

            stanceTimeoutRef.current = setTimeout(() => {
                const idleAction = actions?.IdleBreath;
                const currentInput = getEffectiveInputState(); // Check input *now*

                // --- Set state AFTER stance completes --- 
                isInStance.current = true; // Now definitely in stance
                isActionInProgress.current = false; // Allow actions
                console.log(`[PlayerCharacter ${initialFacing}] Stand Up Stance finished. isInStance=${isInStance.current}, isActionInProgress=${isActionInProgress.current}`);

                // --- Play Idle Breath if conditions met --- 
                if (!isMovingHorizontally.current && !currentInput.block && idleAction) { 
                    console.log(`[PlayerCharacter ${initialFacing}] Conditions met post-stance. Playing IdleBreath.`);
                    idleAction.reset().fadeIn(0.3).play();
                } else {
                    console.warn(`[PlayerCharacter ${initialFacing}] Conditions NOT met for IdleBreath after stance transition.`);
                }
                 stanceTimeoutRef.current = null; // Clear ref after execution
            }, delay); 

        // Dependencies: actions, getEffectiveInputState, isMovingHorizontally (ref)
        }, [actions, getEffectiveInputState]); 

        const triggerKick = useCallback(() => {
            if (!actions?.DuckKick) return;
            console.log(`[PlayerCharacter ${initialFacing}] Triggering Kick`);
            isActionInProgress.current = true;
            isAttackingRef.current = true;
            canDamageRef.current = true;
            actions.IdleBreath?.fadeOut(0.1);
            actions.WalkCycle?.fadeOut(0.1);
            actions.BlockPose?.fadeOut(0.1);
            actions.RightPunch?.fadeOut(0.1);
            actions.DuckKick.reset().fadeIn(0.1).play();
         }, [actions, initialFacing]);

         const triggerPunch = useCallback(() => {
            // --- Log Entry & Prerequisites ---
            console.log(`[PlayerCharacter ${initialFacing}] ==> Attempting triggerPunch`);
            console.log(`  - Mixer: ${!!mixer}, Skeleton: ${!!skeletonRef.current}, InitialPose: ${Object.keys(initialPose || {}).length > 0}, IdleAction: ${!!actions?.IdleBreath}, ActionInProgress: ${isActionInProgress.current}`);

            // --- Check Prerequisites ---
            if (!mixer || !skeletonRef.current || !initialPose || !actions?.IdleBreath) { // Added checks for mixer, skeleton, initialPose, idleAction
                 console.warn(`[PlayerCharacter ${initialFacing}] triggerPunch: Prerequisites missing (mixer, skeleton, initialPose, idleAction).`);
                 return; 
            }
            // --- Action Already in Progress Check --- 
            if (isActionInProgress.current) {
                console.log(`[PlayerCharacter ${initialFacing}] triggerPunch: Ignored, action already in progress.`);
                console.log(`[PlayerCharacter ${initialFacing}] triggerPunch: Ignored, action already in progress.`); // Make this log active
                return;
            }
            
            const punchTypeToCreate = nextPunchTypeRef.current; // Determine which punch to throw this time
            const clipName = punchTypeToCreate === 'right' ? 'RightPunch' : 'LeftPunch';
            console.log(`[PlayerCharacter ${initialFacing}] Triggering ${punchTypeToCreate} Punch (Dynamic) - Proceeding`);
            isActionInProgress.current = true;
            isAttackingRef.current = true;
            canDamageRef.current = true; // Enable damage window

            // --- Capture Current Pose --- 
            const currentPose: StartPose = {};
            skeletonRef.current.bones.forEach(bone => {
                currentPose[bone.name] = { quat: bone.quaternion.clone() };
            });

            // --- Create Clip Dynamically based on type ---
            const dynamicPunchClip = punchTypeToCreate === 'right' ? createRightPunchClip(
                skeletonRef.current,
                initialPose,
                defaultFightStanceTargets, // Pass stance targets
                currentPose,
                clipName,
                0.6 // Default duration (adjust if needed)
            ) : createLeftPunchClip( // Create Left Punch if type is 'left'
                skeletonRef.current,
                initialPose,
                defaultFightStanceTargets,
                currentPose,
                clipName,
                0.6
            );

            if (!dynamicPunchClip) {
                console.error(`[PlayerCharacter ${initialFacing}] triggerPunch: Failed to create dynamic punch clip.`);
                isActionInProgress.current = false; // Reset flags if clip creation fails
                isAttackingRef.current = false;
                canDamageRef.current = false;
                return;
            }

            // --- Create and Play Dynamic Action --- 
            const punchAction = mixer.clipAction(dynamicPunchClip);
            punchAction.setLoop(THREE.LoopOnce, 1);
            punchAction.clampWhenFinished = true; 

            // --- Stop Conflicting Actions --- 
            actions.IdleBreath.fadeOut(0.1);
            actions.WalkCycle?.fadeOut(0.1);
            actions.BlockPose?.fadeOut(0.1); // Fade out if blocking
            actions.DuckPose?.fadeOut(0.1); // Fade out if ducking
            actions.DuckKick?.fadeOut(0.1); // Fade out if duck kicking (shouldn't happen with isActionInProgress)

            // --- Play the Dynamic Punch --- 
            console.log(`[PlayerCharacter ${initialFacing}] Playing dynamic ${punchTypeToCreate} action.`);
            punchAction.reset().fadeIn(0.1).play();

            // --- Flip the type for the NEXT punch AFTER successfully starting this one ---
            nextPunchTypeRef.current = punchTypeToCreate === 'right' ? 'left' : 'right';
            console.log(`[PlayerCharacter ${initialFacing}] Set next punch type in ref to: ${nextPunchTypeRef.current}`);

        }, [actions, mixer, initialPose, initialFacing]);

        // --- END MOVED DEFINITIONS ---


        // --- Mixer Finished Listener ---
        useEffect(() => {
             if (!mixer || !actions) return;
             const idleAction = actions.IdleBreath;
             const duckAction = actions.DuckPose;
             const stanceAction = actions.GoToFightStance;

             const listener = (e: AnimationFinishedEvent) => {
                const finishedActionName = Object.keys(actions).find(name => actions[name] === e.action);
                const finishedClipName = e.action.getClip().name;

                // --- Handle finishing DYNAMIC Punch ---
                if (finishedClipName === 'RightPunch' || finishedClipName === 'LeftPunch') {
                    console.log(`[PlayerCharacter ${initialFacing} Anim Finished] Dynamic Punch finished.`);
                    isActionInProgress.current = false;
                    isAttackingRef.current = false;
                    canDamageRef.current = false;
                    const finishedAction = e.action;
                    const finishedClip = finishedAction.getClip();
                    if (mixer) { mixer.uncacheAction(finishedClip, finishedAction.getRoot()); mixer.uncacheClip(finishedClip); }
                    if (canFight && !isBlockingRef.current && !isMovingHorizontally.current && !isDuckingRef.current) {
                        idleAction?.reset().fadeIn(0.3).play();
                    }
                }
                // --- Handle DuckKick ---
                else if (e.action === actions.DuckKick) {
                    console.log(`[PlayerCharacter ${initialFacing} Anim Finished] DuckKick finished.`);
                    isActionInProgress.current = false;
                    isAttackingRef.current = false;
                    canDamageRef.current = false;
                    if (canFight) isDuckingRef.current = true;
                }
                // --- Handle DuckPose ---
                else if (e.action === duckAction) {
                    console.log(`[PlayerCharacter ${initialFacing}] DuckPose animation transition finished.`);
                    isActionInProgress.current = false;
                }
                // --- Handle BlockPose ---
                 else if (e.action === actions.BlockPose) {
                     isActionInProgress.current = false;
                 }
                 // --- Handle finishing Intro transitions (Original logic) ---
                 else if (e.action === actions.TransitionToHello && actions.HelloWaveLoop) {
                     console.log(`[PlayerCharacter ${initialFacing} Intro] TransitionToHello finished. Playing HelloWaveLoop.`);
                     actions.HelloWaveLoop.reset().fadeIn(0.2).play();
                     currentIntroLoopAction.current = actions.HelloWaveLoop;
                 } else if (e.action === actions.TransitionToArmsCrossed && actions.ArmsCrossedBreath) {
                     console.log(`[PlayerCharacter ${initialFacing} Intro] TransitionToArmsCrossed finished. Playing ArmsCrossedBreath.`);
                     actions.ArmsCrossedBreath.reset().fadeIn(0.2).play();
                     currentIntroLoopAction.current = actions.ArmsCrossedBreath;
                 } else if (e.action === actions.Bow) {
                     console.log(`[PlayerCharacter ${initialFacing} Intro] Bow finished.`);
                     currentIntroLoopAction.current = null;
                 }
                 // --- Handle finishing GoToFightStance ---
                 else if (stanceAction && e.action === stanceAction) {
                     console.log(`[PlayerCharacter ${initialFacing}] GoToFightStance finished. Playing IdleBreath.`);
                     idleAction?.reset().fadeIn(0.2).play();
                      isInStance.current = true;
                 }
            };
            mixer.addEventListener('finished', listener);
            return () => mixer.removeEventListener('finished', listener);
        }, [mixer, actions, canFight, initialFacing]);


        // --- NEW: Effect to Handle Intro Animation Trigger ---
        useEffect(() => {
            // Log dependencies whenever the effect runs
            console.log(`[PlayerCharacter ${initialFacing} Intro Effect Check] fightPhase: ${fightPhase}, startIntroProp: ${startIntroAnimation}, type: ${introAnimationType}, actions ready: ${!!actions}`);

            // ---> Move Check Up <--- 
            // Only proceed if it's this character's turn for the intro
            if (!startIntroAnimation || !introAnimationType || !actions) {
                 return; 
            }

            // Now we know startIntroAnimation is true for this character
            console.log(`[PlayerCharacter ${initialFacing}] Starting Intro Animation Trigger Logic for Type: ${introAnimationType}`); 
            const wrapper = modelWrapperRef.current;
            if (!wrapper) {
                console.error(`[PlayerCharacter ${initialFacing}] ModelWrapper ref not found for intro rotation.`);
                return;
            }

            // --- NEW: Rotate character to face camera before intro animation ---
            // Try the SAME rotation for both: -90 degrees
            const targetYRotation = -Math.PI / 2;
            console.log(`[PlayerCharacter ${initialFacing}] Setting intro rotation: ${targetYRotation.toFixed(3)}`);
            wrapper.rotation.y = targetYRotation;
            // --- End Rotation ---

            // Fade out any existing action
            // --- Fade out (only when starting intro) ---
            console.log(`[PlayerCharacter ${initialFacing}] Fading out other actions...`); 
            Object.values(actions).forEach(action => {
                 // Add extra check for action existence before fadeOut
                 if (action) { 
                      // Optionally log which action is being faded
                      // console.log(`[PlayerCharacter ${initialFacing}] Fading out: ${Object.keys(actions).find(name => actions[name] === action)}`);
                      action.fadeOut(0.1);
                 }
            });
            currentIntroLoopAction.current = null;

            let transitionAction: THREE.AnimationAction | undefined | null = null;
            let loopAction: THREE.AnimationAction | undefined | null = null;     // Allow null from actions

            // --- Select Actions ---
            switch (introAnimationType) {
                case 'Hello':
                    transitionAction = actions.TransitionToHello;
                    loopAction = actions.HelloWaveLoop;
                    break;
                case 'ArmsCrossed':
                    transitionAction = actions.TransitionToArmsCrossed;
                    loopAction = actions.ArmsCrossedBreath;
                    break;
                case 'Bow':
                    transitionAction = actions.Bow;
                    break;
                default:
                    console.warn(`[PlayerCharacter ${initialFacing}] Unknown intro animation type: ${introAnimationType}.`);
                    return;
            }
             // Log selected actions
             console.log(`[PlayerCharacter ${initialFacing}] Selected Actions - Transition: ${transitionAction ? 'Found' : 'None'}, Loop: ${loopAction ? 'Found' : 'None'}`);

            // --- Play Actions ---
            // Check if action exists before playing
            if (transitionAction) {
                 console.log(`[PlayerCharacter ${initialFacing}] Playing Transition Action...`); // Log play transition
                 transitionAction.reset().fadeIn(0.3).play();
            } else if (loopAction) {
                 console.log(`[PlayerCharacter ${initialFacing}] Playing Loop Action directly...`); // Log play loop
                 loopAction.reset().fadeIn(0.3).play();
                 currentIntroLoopAction.current = loopAction; // Assign only if loopAction exists
            } else {
                 console.warn(`[PlayerCharacter ${initialFacing}] No intro action found to play for type: ${introAnimationType}`); // Log no action found
            }
            
        }, [startIntroAnimation, introAnimationType, actions, initialFacing, fightPhase]);


         // --- NEW: Effect to Handle Fight Phase Changes (Post-Intro) ---
         useEffect(() => {
             if (!actions || !mixer || !skeletonRef.current || Object.keys(initialPose).length === 0) { // Added checks for mixer, skeleton, initialPose
                 console.log(`[PlayerCharacter ${initialFacing}] Fight Phase Effect: Missing prerequisites (actions, mixer, skeleton, initialPose)`);
                 return;
             }
             const idleAction = actions.IdleBreath;
             const stanceAction = actions.GoToFightStance;

             // Check if we are specifically entering PRE_FIGHT and not already in stance
             if (fightPhase === 'PRE_FIGHT' && !isInStance.current) {
                 console.log(`[PlayerCharacter ${initialFacing}] Phase PRE_FIGHT. Resetting pose and transitioning to Stance.`);
                 
                 // 1. Stop intro loop if active
                 if (currentIntroLoopAction.current) {
                     console.log(`[PlayerCharacter ${initialFacing}] Fading out intro loop before stance: ${Object.keys(actions).find(name => actions[name] === currentIntroLoopAction.current)}`);
                     currentIntroLoopAction.current.fadeOut(0.1); // Faster fadeout
                     currentIntroLoopAction.current = null; // Clear the ref
                 }
                 
                 // 2. Stop all other actions immediately
                 mixer.stopAllAction();
                 console.log(`[PlayerCharacter ${initialFacing}] Stopped all actions.`);

                 // 3. Reset skeleton to initial pose MANUALLY
                 console.log(`[PlayerCharacter ${initialFacing}] Manually resetting skeleton to initial pose.`);
                 skeletonRef.current.bones.forEach(bone => {
                     const boneName = bone.name;
                     const initial = initialPose[boneName];
                     if (initial) {
                         bone.position.copy(initial.pos);
                         bone.quaternion.copy(initial.quat);
                         bone.scale.copy(initial.scale);
                     } else {
                          console.warn(`[PlayerCharacter ${initialFacing}] Missing initial pose data for bone: ${boneName} during PRE_FIGHT reset.`);
                     }
                 });
                 // Force update the matrix world after manual changes if needed? May not be necessary before starting new animation.
                 // groupRef.current?.updateMatrixWorld(true); 

                 // 4. Play the stance transition
                 if (stanceAction) {
                     console.log(`[PlayerCharacter ${initialFacing}] Playing GoToFightStance.`);
                     stanceAction.reset().fadeIn(0.5).play(); // Transition to fight stance
                 } else {
                     console.error(`[PlayerCharacter ${initialFacing}] GoToFightStance action not found!`);
                 }

             } 
             // --- REFINED Condition for Stopping Actions ---
             // Only stop actions if moving OUT of the active fight/setup phases
             else if (fightPhase !== 'FIGHT' && fightPhase !== 'PRE_FIGHT' && fightPhase !== 'READY' && fightPhase !== 'INTRO_P1' && fightPhase !== 'INTRO_P2' && fightPhase !== 'GAME_OVER') { // <-- ADD GAME_OVER exclusion
                 // Now only runs on e.g., LOADING, INTRO_START

                 console.log(`[PlayerCharacter ${initialFacing}] Phase ${fightPhase}. Stopping non-intro actions.`); // Updated log

                 // Reset relevant state flags
                 isActionInProgress.current = false;
                 isAttackingRef.current = false;
                 isBlockingRef.current = false;
                 isDuckingRef.current = false;
                 isMovingHorizontally.current = false;
                 isInStance.current = false; // No longer in fight stance

                 // Fade out all fight-related actions, BUT NOT the intro loop if it's still active
                 Object.values(actions).forEach(action => {
                     const introLoop = currentIntroLoopAction.current;
                     // Only fade if it exists AND it's not the current intro loop
                     if (action && (!introLoop || action !== introLoop)) { 
                         action.fadeOut(0.2);
                     }
                 });
                
                 // Don't clear currentIntroLoopAction.current here, let the intro effect manage it
             }

         }, [fightPhase, actions, mixer, initialPose, isInStance, initialFacing]); // Added mixer and initialPose dependencies

         // --- NEW: Effect to Handle Game Over (Fall) --- 
         useEffect(() => {
             if (fightPhase === 'GAME_OVER' && currentHealth <= 0 && fallBackwardAction && skeletonRef.current) {
                 console.log(`[PlayerCharacter ${initialFacing}] GAME OVER - LOSER Check. Fall Action: ${actions?.FallBackward?.isRunning()}, ActionInProgress: ${isActionInProgress.current}`);
                  // Check if fall isn't already playing AND ensure no other action is mid-way (like a punch)
                  if (!actions?.FallBackward?.isRunning() && !isAttackingRef.current) { // Added !isAttackingRef check
                     mixer?.stopAllAction(); // Stop everything else forcefully
                     isActionInProgress.current = true; // Prevent interference DURING fall trigger

                     const currentPose: StartPose = {};
                     skeletonRef.current.bones.forEach(bone => {
                         currentPose[bone.name] = { quat: bone.quaternion.clone() };
                     });

                     const fallClip = createFallBackwardClip(skeletonRef.current, initialPose, currentPose, 'FallBackward_Dynamic');
                     if (fallClip) {
                         const dynamicFallAction = mixer.clipAction(fallClip);
                         dynamicFallAction.setLoop(THREE.LoopOnce, 1);
                         dynamicFallAction.clampWhenFinished = true;
                         dynamicFallAction.reset().fadeIn(0.2).play();
                         // Note: isActionInProgress remains true while falling animation plays
                         console.log(`[PlayerCharacter ${initialFacing}] Playing dynamic FallBackward.`);
                     } else {
                         console.error(`[PlayerCharacter ${initialFacing}] Failed to create dynamic FallBackward clip.`);
                         isActionInProgress.current = false; // Reset if fall fails
                     }
                 }
             }
         }, [fightPhase, currentHealth, fallBackwardAction, actions?.FallBackward, mixer, initialPose, initialFacing, skeletonRef]);


        // --- Effect to Set Up WINNER State --- 
         useEffect(() => {
             let setupTimer: NodeJS.Timeout | undefined;

             // Trigger ONLY when phase becomes GAME_OVER and health is positive
             if (fightPhase === 'GAME_OVER' && currentHealth > 0) {
                 console.log(`[PlayerCharacter ${initialFacing}] GAME OVER - WINNER Check. Setting up state.`);
                 if (winnerRotationTarget.current === null) { // Check if not already set up
                     // Start setup after a delay
                     setupTimer = setTimeout(() => {
                         console.log(`[PlayerCharacter ${initialFacing}] Starting delayed VICTORY setup.`);
                         mixer?.stopAllAction();
                         winnerRotationTarget.current = -Math.PI / 2; // Target rotation (face camera)
                         winnerRotationComplete.current = false; // Reset rotation flag
                         victoryAnimPlayed.current = false; // Reset animation flag
                         // Reset potentially conflicting state flags *after* delay
                         isActionInProgress.current = false;
                         isMovingHorizontally.current = false;
                         isInStance.current = false; // Winner is not in fight stance anymore
                     }, 2000); // 2-second delay
                 }
             }
             // Reset winner state if phase changes away from GAME_OVER
             else if (fightPhase !== 'GAME_OVER') {
                  if (winnerRotationTarget.current !== null) { // Only reset if it was set
                      console.log(`[PlayerCharacter ${initialFacing}] Resetting WINNER state.`);
                      winnerRotationTarget.current = null;
                      winnerRotationComplete.current = false;
                      victoryAnimPlayed.current = false;
                  }
             }
             // Cleanup function for the effect
             return () => {
                  if (setupTimer) clearTimeout(setupTimer);
             };
         }, [fightPhase, currentHealth, mixer, initialFacing]); // Minimal dependencies


        // --- Guarded Action Trigger Effect --- 
        useEffect(() => {
            // *** CRUCIAL: Only allow triggering actions during FIGHT phase ***
            if (fightPhase !== 'FIGHT') {
                return;
            }
            // Existing checks for canFight and actions are still relevant
            if (!canFight || !actions) {
                return;
            }

            // ... (Keep the internal logic exactly as it was for duck, block, punch, kick triggers) ...
            const currentInput = getEffectiveInputState();
            const shouldBeBlocking = currentInput.block;
            const shouldBeDucking = currentInput.duck;

            if (shouldBeBlocking && !isBlockingRef.current && !isActionInProgress.current) triggerBlock();
            else if (!shouldBeBlocking && isBlockingRef.current && !isActionInProgress.current) stopBlock();
            else if (shouldBeDucking && !isDuckingRef.current && !isBlockingRef.current && !isActionInProgress.current) triggerDuck();
            else if (!shouldBeDucking && isDuckingRef.current && !isActionInProgress.current) triggerStandUp();
            else if (currentInput.punch && !isActionInProgress.current && !isBlockingRef.current) {
                if (isDuckingRef.current && actions.DuckKick) triggerKick();
                else if (!isDuckingRef.current) triggerPunch();
            }

        }, [actions, isInStance, isActionInProgress, getEffectiveInputState, canFight, fightPhase, // Add fightPhase dependency
            triggerBlock, stopBlock, triggerDuck, triggerStandUp, triggerKick, triggerPunch]); // Add helpers to dependencies


        // --- Frame Update ---
        useFrame((state, delta) => {
            delta = Math.min(delta, 0.05);
            const group = groupRef.current;
            const modelWrapper = modelWrapperRef.current;
            if (!group || !isLoaded || !modelWrapper) return;

            // --- [PRIORITY 1] Handle GAME OVER States ---
            if (fightPhase === 'GAME_OVER') {
                // --- Loser Logic --- 
                if (currentHealth <= 0) {
                    // Only update mixer for fall animation
                    if (actions?.FallBackward?.isRunning() && mixer) {
                        mixer.update(delta);
                    }
                    return; // Stop ALL other updates for loser
                }
                // --- Winner Logic --- 
                else {
                    const targetY = winnerRotationTarget.current;
                    // 1. Rotate Winner
                    if (targetY !== null && !winnerRotationComplete.current) {
                        const currentY = modelWrapper.rotation.y;
                        const rotationThreshold = 0.05;
                        modelWrapper.rotation.y = THREE.MathUtils.lerp(currentY, targetY, 0.08);
                        if (Math.abs(currentY - targetY) < rotationThreshold) {
                            winnerRotationComplete.current = true;
                            modelWrapper.rotation.y = targetY; // Snap
                            console.log(`[PlayerCharacter ${initialFacing}] Victory rotation complete.`);
                        }
                    }
                    // 2. Play Victory Animation (ONCE after rotation)
                    else if (winnerRotationComplete.current && !victoryAnimPlayed.current) {
                        victoryAnimPlayed.current = true; // Prevent re-triggering
                        const animName = getRandomVictoryAnimation();
                        let victoryAction: THREE.AnimationAction | undefined | null = null;

                        console.log(`[PlayerCharacter ${initialFacing}] Playing victory anim: ${animName}`);
                        switch (animName) {
                            case 'Hello':       victoryAction = actions?.TransitionToHello; break;
                            case 'ArmsCrossed': victoryAction = actions?.TransitionToArmsCrossed; break;
                            case 'Bow':         victoryAction = actions?.Bow; break;
                        }

                        if (victoryAction) {
                            victoryAction.reset().fadeIn(0.3).play();
                        } else {
                            console.warn(`[PlayerCharacter ${initialFacing}] Victory animation action "${animName}" not found!`);
                        }
                    }

                    // Always update mixer for winner (rotation lerp or anim)
                    if (mixer) mixer.update(delta);
                    return; // Stop ALL other updates for winner
                }
            } // --- End GAME_OVER block ---


            // --- [PRIORITY 2] Handle Non-Fighting Phases (Intro, Pre-Fight, Loading) ---
            // This block now runs ONLY if fightPhase is NOT GAME_OVER
            if (!canFight) { // Covers Intro, Pre-Fight, Loading etc.
                 manualVelocityRef.current = { x: 0, y: 0, z: 0 };
                 group.position.copy(positionRef.current);

                 // Update mixer ONLY for relevant non-fight animations
                 let shouldUpdateMixer = false;
                 // ... (keep existing checks for Intro, Pre-Fight anims) ...
                 const introLoop = currentIntroLoopAction.current;
                 if (introLoop && introLoop.isRunning()) shouldUpdateMixer = true;
                 else if (actions?.TransitionToHello?.isRunning()) shouldUpdateMixer = true;
                 else if (actions?.TransitionToArmsCrossed?.isRunning()) shouldUpdateMixer = true;
                 else if (actions?.Bow?.isRunning()) shouldUpdateMixer = true;
                 else if (actions?.GoToFightStance?.isRunning()) shouldUpdateMixer = true;


                 if (shouldUpdateMixer && mixer) {
                     mixer.update(delta);
                 }
                 return; // Prevent physics/movement
            }


            // --- [PRIORITY 3] FIGHT PHASE LOGIC (Physics, Movement, Standard Anims) ---
            // This block runs ONLY if fightPhase is FIGHT
            // ***** Keep this block exactly as it was when movement worked *****
            const currentPos = positionRef.current;
            const velocity = manualVelocityRef.current;
            const currentInput = getEffectiveInputState(); // Get input here for physics
            let targetVelocityX = 0;
            const isGrounded = hasHitGround.current && currentPos.y <= GROUND_LEVEL;

            // Horizontal Movement
            if (!isActionInProgress.current && isGrounded) { // Revert to simpler check maybe?
                 if (currentInput.left || currentInput.right) {
                    targetVelocityX = currentInput.left ? -CHARACTER_WALK_SPEED : CHARACTER_WALK_SPEED;
                 }
            }
             if (isGrounded) { velocity.x = targetVelocityX; }

            // Vertical Movement (Jump & Gravity)
            if (currentInput.jump && isGrounded && !isActionInProgress.current) {
                velocity.y = JUMP_FORCE;
                 if (currentInput.left) velocity.x = -JUMP_HORIZONTAL_SPEED;
                 else if (currentInput.right) velocity.x = JUMP_HORIZONTAL_SPEED;
                 else velocity.x = 0; // Keep jump X velocity setting
            }
            if (!isGrounded || velocity.y > 0) {
                velocity.y -= GRAVITY * delta;
            }

            // Boundary Checks
            const nextX = currentPos.x + velocity.x * delta;
            if (nextX <= MIN_X || nextX >= MAX_X) {
                velocity.x = 0; // Stop horizontal movement if next step is out of bounds
            }

            // Update Position
            currentPos.x += velocity.x * delta;
            currentPos.y += velocity.y * delta;
            currentPos.z += velocity.z * delta;

            // Ground Collision / State Update
            if (currentPos.y <= GROUND_LEVEL && velocity.y <= 0) {
                 currentPos.y = GROUND_LEVEL;
                 velocity.y = 0;
                 if (!hasHitGround.current) { hasHitGround.current = true; }
            }
            group.position.copy(currentPos);

            // Animation Control (Walk/Idle Trigger - Only during FIGHT)
            const isCurrentlyMovingHorizontallyOnGround = isGrounded && targetVelocityX !== 0;
            if (!isActionInProgress.current && isGrounded && isCurrentlyMovingHorizontallyOnGround !== isMovingHorizontally.current) {
                const walkAction = actions?.WalkCycle;
                const idleAction = actions?.IdleBreath;
                if (isCurrentlyMovingHorizontallyOnGround) {
                    if (isInStance.current && idleAction) idleAction.fadeOut(0.2);
                    if (walkAction) walkAction.reset().fadeIn(0.2).play();
                } else {
                    if (walkAction) walkAction.fadeOut(0.2);
                    if (idleAction && isInStance.current) idleAction.reset().fadeIn(0.3).play();
                }
                isMovingHorizontally.current = isCurrentlyMovingHorizontallyOnGround;
            }

            // Mixer update for FIGHT phase
            if (mixer) {
                mixer.update(delta);
            }
            // ***** End of FIGHT phase logic block *****

        }); // End useFrame

        // --- Render ---
        if (!isLoaded) { return null; }

        return (
            <group ref={mainGroupRefCallback} name={`CharacterModelGroup-${initialFacing}`}>
                <group ref={modelWrapperRef} name={`ModelWrapper-${initialFacing}`}>
                    <primitive object={scene} />
                </group>
                {/* Debug Cylinder */}
                <mesh position={[0, DEBUG_CYLINDER_HEIGHT / 2, 0]} visible={false}>
                    <cylinderGeometry args={[DEBUG_CYLINDER_RADIUS, DEBUG_CYLINDER_RADIUS, DEBUG_CYLINDER_HEIGHT, 16]} />
                    <meshStandardMaterial color={isPlayerControlled ? "blue" : "red"} wireframe transparent opacity={0.5} />
                </mesh>
            </group>
        );
    }
));

PlayerCharacter.displayName = 'PlayerCharacter';