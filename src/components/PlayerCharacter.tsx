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
    createDuckPoseClip,
    createBlockPoseClip,
    createDuckKickClip,
    defaultFightStanceTargets, // Needed by createWalkCycleClip 
    blockTargets,
    type InitialPoseData, 
    // type EulerOrder // Not directly needed here
} from '../lib/animations/clips';

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
    forceBlock?: boolean;
    canStartAnimation: boolean;
}

interface AnimationFinishedEvent extends THREE.Event {
    type: 'finished';
    action: THREE.AnimationAction;
    direction: number;
}

// --- Constants ---
const CHARACTER_WALK_SPEED = 2;
const GRAVITY = 9.81 * 2;
const JUMP_FORCE = 6;
const JUMP_HORIZONTAL_SPEED = 1.8; // Speed for forward/backward jumps
const GROUND_LEVEL = 0;
// Debug Collider Visuals (Adjusted Size)
const DEBUG_CYLINDER_HEIGHT = 1; // Slightly shorter
const DEBUG_CYLINDER_RADIUS = 0.09; // Significantly narrower
// Re-define props for useBox
// const playerPhysicsProps: BoxProps & BodyProps = { ... }; // Can be commented out if not used

// Keep initialPosition definition if needed for visual placement
// const initialPosition: [number, number, number] = [-2, 2, 0]; 

// --- Component Definition with forwardRef ---
export const PlayerCharacter = memo(forwardRef<PlayerCharacterHandle, PlayerCharacterProps>(({ 
    modelUrl, 
    initialPosition,
    initialFacing, 
    isPlayerControlled, 
    forceBlock = false,
    canStartAnimation
}, ref) => {
    // --- Refs ---
    const groupRef = useRef<THREE.Group>(null);
    const modelWrapperRef = useRef<THREE.Group>(null);
    const mainGroupRefCallback = useCallback((node: THREE.Group | null) => {
        groupRef.current = node;
    }, []);

    // Moved attack state refs here, before useImperativeHandle
    const isAttackingRef = useRef(false);
    const canDamageRef = useRef(false); // Tracks if the current attack instance can still deal damage
    const isBlockingRef = useRef(false);
    const isDuckingRef = useRef(false); // Track ducking state

    // Movement/State refs
    const manualVelocityRef = useRef({ x: 0, y: 0, z: 0 });
    const positionRef = useRef(new THREE.Vector3(...initialPosition));
    const skeletonRef = useRef<THREE.Skeleton | null>(null);
    const isMovingHorizontally = useRef(false);
    const hasHitGround = useRef(false);
    const isInStance = useRef(false);
    const isActionInProgress = useRef(false); // General flag for non-idle/walk actions

    // --- NEW: Effect to synchronize positionRef with prop ---
    useEffect(() => {
        console.log(`[PlayerCharacter ${initialFacing}] initialPosition prop updated:`, initialPosition);
        positionRef.current.set(...initialPosition);
        console.log(`[PlayerCharacter ${initialFacing}] positionRef updated to:`, positionRef.current);
        // Reset ground/velocity state when position changes drastically (like on navigation)
        hasHitGround.current = false;
        manualVelocityRef.current = { x: 0, y: 0, z: 0 };
    }, [initialPosition]); // Add initialPosition to dependency array

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
    const [pressedKeys, setPressedKeys] = useState<{ 
        left: boolean; 
        right: boolean; 
        punch: boolean; // Space
        duck: boolean;  // ArrowDown
        block: boolean;
        jump: boolean; // Added jump state
    }>({ left: false, right: false, punch: false, duck: false, block: false, jump: false });
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

    // --- Input Handling ---
    useEffect(() => {
        if (!isPlayerControlled) return;
         const handleKeyDown = (event: KeyboardEvent) => {
             switch (event.key) {
                 case 'ArrowLeft': setPressedKeys(prev => ({ ...prev, left: true })); break;
                 case 'ArrowRight': setPressedKeys(prev => ({ ...prev, right: true })); break;
                 case 'ArrowDown': setPressedKeys(prev => ({ ...prev, duck: true })); break;
                 case ' ': setPressedKeys(prev => ({ ...prev, punch: true })); break;
                 case 'b': setPressedKeys(prev => ({ ...prev, block: true })); break;
                 case 'ArrowUp': setPressedKeys(prev => ({ ...prev, jump: true })); break; // Added jump key
             }
        };
        const handleKeyUp = (event: KeyboardEvent) => {
              switch (event.key) {
                 case 'ArrowLeft': setPressedKeys(prev => ({ ...prev, left: false })); break;
                 case 'ArrowRight': setPressedKeys(prev => ({ ...prev, right: false })); break;
                 case 'ArrowDown': setPressedKeys(prev => ({ ...prev, duck: false })); break;
                 case ' ': setPressedKeys(prev => ({ ...prev, punch: false })); break;
                 case 'b': setPressedKeys(prev => ({ ...prev, block: false })); break;
                 case 'ArrowUp': setPressedKeys(prev => ({ ...prev, jump: false })); break; // Added jump key
             }
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [isPlayerControlled]);

    // --- Create Animation Clips ---
    const walkCycleClip = useMemo(() => {
        if (!skeletonRef.current || Object.keys(initialPose).length === 0) return null;
        return createWalkCycleClip(skeletonRef.current, initialPose, defaultFightStanceTargets, 'WalkCycle', 0.7);
    }, [initialPose]);
    const fightStanceClip = useMemo(() => {
        if (!skeletonRef.current || Object.keys(initialPose).length === 0) return null;
        return createFightStanceClip(skeletonRef.current, initialPose, defaultFightStanceTargets, 'GoToFightStance');
    }, [initialPose]);
    const idleBreathClip = useMemo(() => {
        if (!skeletonRef.current || Object.keys(initialPose).length === 0) return null;
        return createIdleBreathClip(skeletonRef.current, defaultFightStanceTargets, initialPose);
    }, [initialPose]);
    const rightPunchClip = useMemo(() => {
         if (!skeletonRef.current || Object.keys(initialPose).length === 0) return null;
        return createRightPunchClip(skeletonRef.current, initialPose, defaultFightStanceTargets);
    }, [initialPose]);
    const duckPoseClip = useMemo(() => {
         if (!skeletonRef.current || Object.keys(initialPose).length === 0) return null;
        return createDuckPoseClip(skeletonRef.current, initialPose, defaultFightStanceTargets);
    }, [initialPose]);
    const blockPoseClip = useMemo(() => {
        if (!skeletonRef.current || Object.keys(initialPose).length === 0) return null;
        return createBlockPoseClip(skeletonRef.current, initialPose, defaultFightStanceTargets);
    }, [initialPose]);
    const duckKickClip = useMemo(() => {
        if (!skeletonRef.current || Object.keys(initialPose).length === 0) return null;
        return createDuckKickClip(skeletonRef.current, initialPose);
    }, [initialPose]);

    // --- Setup Animation Actions ---
    const animationsToUse = useMemo(() => {
        const clips = [];
        if (walkCycleClip) clips.push(walkCycleClip);
        if (fightStanceClip) clips.push(fightStanceClip);
        if (idleBreathClip) clips.push(idleBreathClip);
        if (rightPunchClip) clips.push(rightPunchClip);
        if (duckPoseClip) clips.push(duckPoseClip);
        if (blockPoseClip) clips.push(blockPoseClip);
        if (duckKickClip) clips.push(duckKickClip);
        return clips;
    }, [walkCycleClip, fightStanceClip, idleBreathClip, rightPunchClip, duckPoseClip, blockPoseClip, duckKickClip]);
    const { actions, mixer } = useAnimations(animationsToUse, groupRef);

    // --- Configure Animation Actions ---
    useEffect(() => {
         // --- Add check for animation start signal --- 
         if (!canStartAnimation) {
             console.log("[PlayerCharacter Anims] Waiting for canStartAnimation signal...");
             // Optionally stop/reset actions if signal becomes false later?
             // actions?.IdleBreath?.stop(); 
             return; // Don't configure or play if not allowed yet
         }

         console.log("[PlayerCharacter Anims] canStartAnimation is true. Configuring actions.");

         if (actions?.WalkCycle) actions.WalkCycle.setLoop(THREE.LoopRepeat, Infinity);
         if (actions?.GoToFightStance) { actions.GoToFightStance.setLoop(THREE.LoopOnce, 1); actions.GoToFightStance.clampWhenFinished = true; }
         if (actions?.IdleBreath) actions.IdleBreath.setLoop(THREE.LoopRepeat, Infinity);
         if (actions?.RightPunch) { actions.RightPunch.setLoop(THREE.LoopOnce, 1); actions.RightPunch.clampWhenFinished = true; }
         if (actions?.DuckPose) { actions.DuckPose.setLoop(THREE.LoopOnce, 1); actions.DuckPose.clampWhenFinished = true; }
         if (actions?.BlockPose) {
            actions.BlockPose.setLoop(THREE.LoopOnce, 1);
            actions.BlockPose.clampWhenFinished = true;
         }
         if (actions?.DuckKick) {
            actions.DuckKick.setLoop(THREE.LoopOnce, 1);
            actions.DuckKick.clampWhenFinished = true;
         }

         if (mixer) mixer.timeScale = 1;

         // Initial Idle play (Remove setTimeout)
         if (actions?.IdleBreath && !isInStance.current) {
            console.log("[PlayerCharacter Anims] Playing initial IdleBreath NOW.");
            actions.IdleBreath.reset().fadeIn(0.2).play();
            isInStance.current = true;
            // Cleanup function is no longer needed for a timeout here
            // return () => { ... };
         }
    }, [actions, mixer, canStartAnimation]); // Add canStartAnimation to dependency array

    // --- Mixer Finished Listener --- 
    useEffect(() => {
         if (!mixer || !actions) return;
         const idleAction = actions.IdleBreath;
         const duckAction = actions.DuckPose; // Get duck action for transitions
         const listener = (e: AnimationFinishedEvent) => {
            if (e.action === actions.RightPunch) {
                isActionInProgress.current = false; 
                isAttackingRef.current = false;
                canDamageRef.current = false;
                if (!isBlockingRef.current && !isMovingHorizontally.current && !isDuckingRef.current) {
                    idleAction?.reset().fadeIn(0.3).play(); 
                }
            } else if (e.action === actions.DuckKick) {
                isActionInProgress.current = false;
                isAttackingRef.current = false;
                canDamageRef.current = false;
                isDuckingRef.current = true; // Remain ducking after kick
                // Fade back into the held duck pose smoothly if the user is still holding duck
                duckAction?.reset().fadeIn(0.1).play(); 
            } else if (e.action === actions.DuckPose) {
                // isDuckingRef is already true from the trigger
                isActionInProgress.current = false; // Duck transition finished
            } else if (e.action === actions.BlockPose) {
                isActionInProgress.current = false; // Block transition finished
                // isBlockingRef is already true from the trigger
            }
        };
        mixer.addEventListener('finished', listener);
        return () => mixer.removeEventListener('finished', listener);
    }, [mixer, actions]);

    // --- Effect to Handle Action Triggers --- 
    useEffect(() => {
        const shouldBeBlocking = !isPlayerControlled ? forceBlock : pressedKeys.block;
        const shouldBeDucking = pressedKeys.duck;
        
        const idleAction = actions?.IdleBreath;
        const walkAction = actions?.WalkCycle;
        const punchAction = actions?.RightPunch;
        const duckAction = actions?.DuckPose;
        const blockAction = actions?.BlockPose;
        const kickAction = actions?.DuckKick;

        // --- Blocking --- 
        if (shouldBeBlocking && !isBlockingRef.current && !isActionInProgress.current) {
            isActionInProgress.current = true;
            isBlockingRef.current = true;
            isDuckingRef.current = false; // Can't block and duck
            idleAction?.fadeOut(0.1);
            walkAction?.fadeOut(0.1);
            punchAction?.fadeOut(0.1);
            duckAction?.fadeOut(0.1);
            kickAction?.fadeOut(0.1);
            blockAction?.reset().fadeIn(0.2).play();
        } else if (!shouldBeBlocking && isBlockingRef.current && !isActionInProgress.current) {
            isActionInProgress.current = true; // For fade out duration
            blockAction?.fadeOut(0.2);
            isBlockingRef.current = false;
            // Determine next state after blocking stops
            setTimeout(() => { // Delay setting action false until fade potentially finishes
                 isActionInProgress.current = false;
                 if (shouldBeDucking && !isDuckingRef.current) {
                     // Trigger duck if key is held
                     triggerDuck(); 
                 } else if (isInStance.current && !isMovingHorizontally.current && !shouldBeDucking) {
                     idleAction?.reset().fadeIn(0.3).play();
                 }
            }, 200); // Match fade out duration
        }

        // --- Ducking --- 
        else if (shouldBeDucking && !isDuckingRef.current && !isBlockingRef.current && !isActionInProgress.current) {
            triggerDuck();
        } else if (!shouldBeDucking && isDuckingRef.current && !isActionInProgress.current) {
            triggerStandUp();
        }

        // --- Punch/Kick --- 
        else if (pressedKeys.punch && !isActionInProgress.current && !isBlockingRef.current) { // Check punch trigger, ignore if blocking
            if (isDuckingRef.current && kickAction) { // Trigger Duck Kick
                 triggerKick();
            } else if (!isDuckingRef.current && punchAction) { // Trigger Normal Punch
                 triggerPunch();
            }
        }

    }, [pressedKeys, forceBlock, actions, isInStance, isPlayerControlled, isDuckingRef, isBlockingRef, isActionInProgress]);

    // --- Helper Action Triggers --- 
    const triggerDuck = useCallback(() => {
        if (!actions?.DuckPose) return;
        console.log("Triggering Duck");
        isActionInProgress.current = true;
        isDuckingRef.current = true;
        actions.IdleBreath?.fadeOut(0.1);
        actions.WalkCycle?.fadeOut(0.1);
        actions.RightPunch?.fadeOut(0.1);
        actions.BlockPose?.fadeOut(0.1);
        actions.DuckKick?.fadeOut(0.1);
        actions.DuckPose.reset().fadeIn(0.2).play();
    }, [actions]);

    const triggerStandUp = useCallback(() => {
        if (!actions?.DuckPose || !isDuckingRef.current) return;
        console.log("Triggering Stand Up");
        isActionInProgress.current = true; // Mark as busy during fade
        actions.DuckPose.fadeOut(0.2);
        isDuckingRef.current = false;
        setTimeout(() => { // Allow fade out before potentially going idle
            isActionInProgress.current = false;
            if (isInStance.current && !isMovingHorizontally.current && !pressedKeys.block) { // Don't idle if blocking
                actions.IdleBreath?.reset().fadeIn(0.3).play();
            }
        }, 200); // Match fade out duration
    }, [actions, isInStance, pressedKeys.block]); // Include block key check

    const triggerKick = useCallback(() => {
        if (!actions?.DuckKick) return;
        console.log("Triggering Kick");
        isActionInProgress.current = true;
        isAttackingRef.current = true;
        canDamageRef.current = true;
        actions.IdleBreath?.fadeOut(0.1);
        actions.WalkCycle?.fadeOut(0.1);
        actions.BlockPose?.fadeOut(0.1);
        actions.RightPunch?.fadeOut(0.1); // Fade out punch if somehow active
        // Don't fade out DuckPose, kick should interrupt/override smoothly
        actions.DuckKick.reset().fadeIn(0.1).play();
    }, [actions]);

     const triggerPunch = useCallback(() => {
        if (!actions?.RightPunch) return;
        console.log("Triggering Punch");
        isActionInProgress.current = true;
        isAttackingRef.current = true;
        canDamageRef.current = true;
        actions.IdleBreath?.fadeOut(0.1);
        actions.WalkCycle?.fadeOut(0.1);
        actions.BlockPose?.fadeOut(0.1);
        actions.DuckPose?.fadeOut(0.1);
        actions.DuckKick?.fadeOut(0.1);
        actions.RightPunch.reset().fadeIn(0.1).play();
    }, [actions]);

    // --- Frame Update (Manual Movement, Jump & Animation Trigger) ---
    useFrame((state, delta) => { 
        delta = Math.min(delta, 0.05);
        const group = groupRef.current;
        if (!group || !isLoaded) return;

        const currentPos = positionRef.current;
        const velocity = manualVelocityRef.current;

        // --- Horizontal Movement (Only applies when grounded) ---
        let targetVelocityX = 0;
        const isGrounded = hasHitGround.current && currentPos.y <= GROUND_LEVEL;

        if (isPlayerControlled && !isActionInProgress.current && isGrounded) { 
             if (pressedKeys.left || pressedKeys.right) {
                targetVelocityX = pressedKeys.left ? -CHARACTER_WALK_SPEED : CHARACTER_WALK_SPEED;
            }
        }
        // Apply ground velocity if grounded, otherwise keep existing air velocity
        if (isGrounded) {
             velocity.x = targetVelocityX;
        }
        
        // --- Vertical Movement (Jump & Gravity) ---
        // --- DEBUG LOGGING for JUMP --- 
        // if (isPlayerControlled && pressedKeys.jump) {
        //     console.log(`P1 Trying Jump: isGrounded=${isGrounded} (hasHitGround=${hasHitGround.current}, posY=${currentPos.y.toFixed(3)}), !actionInProgress=${!isActionInProgress.current}`);
        // }
        // --- END DEBUG LOGGING ---

        // Apply Jump Force + Horizontal Jump Velocity
        if (isPlayerControlled && pressedKeys.jump && isGrounded && !isActionInProgress.current) {
            velocity.y = JUMP_FORCE;
            // Apply horizontal jump speed based on keys pressed *at the moment of jump*
            if (pressedKeys.left) {
                velocity.x = -JUMP_HORIZONTAL_SPEED;
            } else if (pressedKeys.right) {
                velocity.x = JUMP_HORIZONTAL_SPEED;
            } else {
                velocity.x = 0; // Neutral jump
            }
             console.log(`---> P1 JUMPING! VelX: ${velocity.x.toFixed(2)}, VelY: ${velocity.y.toFixed(2)}`);
        }
        
        // Apply gravity ONLY if airborne (or starting a jump)
        if (!isGrounded || velocity.y > 0) { // Simplified airborne check
             velocity.y -= GRAVITY * delta;
        } 
        // Note: Ground clamping below handles setting velocity.y = 0 when appropriate

        // --- Update Position ---
        currentPos.x += velocity.x * delta;
        currentPos.y += velocity.y * delta;
        currentPos.z += velocity.z * delta; 

        // --- Ground Collision / State Update ---
        if (currentPos.y <= GROUND_LEVEL && velocity.y <= 0) { 
            if (!isGrounded) { // If we just landed
                // console.log(`P${isPlayerControlled ? 1:2} LANDED`);
            }
            currentPos.y = GROUND_LEVEL;
            velocity.y = 0; 
            // Do NOT reset velocity.x here, let ground movement logic handle it next frame
            if (!hasHitGround.current) {
                 hasHitGround.current = true; 
            }
        } 
        
        group.position.copy(currentPos);

        // --- Animation Control (Walk/Idle Trigger) ---
        const isCurrentlyMovingHorizontallyOnGround = isGrounded && targetVelocityX !== 0;
        // Check grounded state before triggering walk/idle
        if (isPlayerControlled && !isActionInProgress.current && isGrounded && isCurrentlyMovingHorizontallyOnGround !== isMovingHorizontally.current) {
            const walkAction = actions?.WalkCycle;
            const idleAction = actions?.IdleBreath;
            if (isCurrentlyMovingHorizontallyOnGround) {
                if (isInStance.current) idleAction?.fadeOut(0.2);
                walkAction?.reset().fadeIn(0.2).play();
            } else {
                walkAction?.fadeOut(0.2);
                if (idleAction && isInStance.current) idleAction.reset().fadeIn(0.3).play();
            }
            isMovingHorizontally.current = isCurrentlyMovingHorizontallyOnGround;
        } 
        // TODO: Add jump/fall animation triggers based on velocity.y and isGrounded
    });

    // --- Render ---
    if (!isLoaded) { return null; }
    
    return (
        <group ref={mainGroupRefCallback} name="CharacterModelGroup">
            <group ref={modelWrapperRef} name="ModelWrapper">
                 <primitive object={scene} />
            </group>
            <mesh position={[0, DEBUG_CYLINDER_HEIGHT / 2, 0]} visible={false}>
                <cylinderGeometry args={[DEBUG_CYLINDER_RADIUS, DEBUG_CYLINDER_RADIUS, DEBUG_CYLINDER_HEIGHT, 16]} />
                <meshStandardMaterial color={isPlayerControlled ? "blue" : "red"} wireframe transparent opacity={0.5} />
            </mesh>
        </group>
    );
}));

PlayerCharacter.displayName = 'PlayerCharacter';