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
    defaultFightStanceTargets, // Needed by createWalkCycleClip 
    type InitialPoseData, 
    // type EulerOrder // Not directly needed here
} from '../lib/animations/clips';

import { PlayerCharacterHandle } from '@/components/BattleScene'; // Import the handle type

// --- Types ---
interface PlayerCharacterProps { 
    modelUrl: string;
    initialPosition: [number, number, number];
    initialFacing: 'left' | 'right';
    isPlayerControlled: boolean;
}

interface AnimationFinishedEvent extends THREE.Event {
    type: 'finished';
    action: THREE.AnimationAction;
    direction: number;
}

// --- Constants ---
const CHARACTER_WALK_SPEED = 3.5;
// Manual physics constants
const GRAVITY = 9.81 * 2; // Adjust gravity strength as needed
const GROUND_LEVEL = 0;
// Re-define props for useBox
// const playerPhysicsProps: BoxProps & BodyProps = { ... }; // Can be commented out if not used

// Keep initialPosition definition if needed for visual placement
// const initialPosition: [number, number, number] = [-2, 2, 0]; 

// --- Component Definition with forwardRef ---
// Update the forwardRef signature to use the handle type
export const PlayerCharacter = memo(forwardRef<PlayerCharacterHandle, PlayerCharacterProps>(({ 
    modelUrl, 
    initialPosition,
    initialFacing, 
    isPlayerControlled 
}, ref) => {
    // --- Refs ---
    const groupRef = useRef<THREE.Group>(null); // Internal ref for useAnimations & potentially other uses
    const modelWrapperRef = useRef<THREE.Group>(null); // Ref for inner group that holds the model primitive

    // Callback ref to assign to the main group ref
    const mainGroupRefCallback = useCallback((node: THREE.Group | null) => {
        // Assign to internal ref
        groupRef.current = node;
        // Assign to forwarded ref (if needed externally, though handle might be preferred now)
        /*
        if (typeof ref === 'function') {
            ref(node);
        } else if (ref) {
            ref.current = node;
        }
        */
    }, []); // Removed ref dependency as we use imperative handle

    // Expose methods to get the main group and the model wrapper
    useImperativeHandle(ref, () => ({ // Use forwarded ref here
        getMainGroup: () => groupRef.current,
        getModelWrapper: () => modelWrapperRef.current
    }), []); // Empty dependency array ensures the handle doesn't change unnecessarily

    // Ref for manual velocity
    const manualVelocityRef = useRef({ x: 0, y: 0, z: 0 });
    // Use initialPosition prop for the position ref
    const positionRef = useRef(new THREE.Vector3(...initialPosition));
    const skeletonRef = useRef<THREE.Skeleton | null>(null); // Ref for skeleton
    const isMovingHorizontally = useRef(false); // Ref to track horizontal movement state
    const hasHitGround = useRef(false); // Track if ground hit once
    const isInStance = useRef(false); // Track if stance/idle animation is active
    const isActionInProgress = useRef(false); // Track if a non-idle/walk action is playing

    // --- State ---
    const [pressedKeys, setPressedKeys] = useState<{ 
        left: boolean; 
        right: boolean; 
        punch: boolean; // Space
        duck: boolean;  // ArrowDown
    }>({ left: false, right: false, punch: false, duck: false });
    // Re-add isLoaded for GLTF
    const [isLoaded, setIsLoaded] = useState(false);
    const [initialPose, setInitialPose] = useState<Record<string, InitialPoseData>>({}); // State for initial pose

    // --- Apply Initial Facing Rotation --- 
    useEffect(() => {
        // Reverted: Needs isLoaded check
        if (isLoaded && modelWrapperRef.current) {
            // Reverted: Use 0 and Math.PI
            const targetRotation = initialFacing === 'right' 
                ? 0         // Face right (+X)
                : Math.PI;  // Face left (-X)
            console.log(`Setting initial facing for ${isPlayerControlled ? 'P1' : 'P2'}: ${initialFacing}, Target Rot: ${targetRotation.toFixed(2)}`);
            modelWrapperRef.current.rotation.y = targetRotation;
            console.log(`--> Rotation set to: ${modelWrapperRef.current.rotation.y.toFixed(2)}`);
        }
    }, [initialFacing, isPlayerControlled, isLoaded]); // Reverted: isLoaded dependency needed

    // --- Load Model ---
    const { scene, animations: existingAnimations } = useGLTF(modelUrl);

    // --- Capture Skeleton and Initial Pose --- 
    useEffect(() => {
        if (scene && !skeletonRef.current) { 
            console.log("Finding skeleton and capturing initial pose...");
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
                
                // Use @ts-ignore to bypass type checking issue, like in page.tsx
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
                console.log("Skeleton and Initial Pose captured.");
                
            } else {
                console.warn("Could not find skeleton in the model.");
            }
            setIsLoaded(true);
        }
    }, [scene]); 

    // --- Temporary isLoaded Effect --- (Use this for now)
    useEffect(() => {
        if (scene && !isLoaded) {
            const timer = setTimeout(() => setIsLoaded(true), 50);
            return () => clearTimeout(timer);
        }
    }, [scene, isLoaded])

    // --- Input Handling (Conditional) ---
    useEffect(() => {
        // Only attach listeners if this character is player-controlled
        if (!isPlayerControlled) return;

        const handleKeyDown = (event: KeyboardEvent) => {
             // Use key codes or event.key
             switch (event.key) {
                 case 'ArrowLeft':
                     setPressedKeys(prev => ({ ...prev, left: true })); break;
                 case 'ArrowRight':
                     setPressedKeys(prev => ({ ...prev, right: true })); break;
                 case 'ArrowDown':
                     setPressedKeys(prev => ({ ...prev, duck: true })); break;
                 case ' ': // Space bar
                     setPressedKeys(prev => ({ ...prev, punch: true })); break;
             }
        };
        const handleKeyUp = (event: KeyboardEvent) => {
              switch (event.key) {
                 case 'ArrowLeft':
                     setPressedKeys(prev => ({ ...prev, left: false })); break;
                 case 'ArrowRight':
                     setPressedKeys(prev => ({ ...prev, right: false })); break;
                 case 'ArrowDown':
                     setPressedKeys(prev => ({ ...prev, duck: false })); break;
                 case ' ': // Space bar
                     setPressedKeys(prev => ({ ...prev, punch: false })); break; // Set punch false on key up
             }
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [isPlayerControlled]); // Dependency array includes the control flag

    // --- Create Walk Animation Clip --- 
    const walkCycleClip = useMemo(() => {
        if (!skeletonRef.current || Object.keys(initialPose).length === 0) {
             console.log("Waiting for skeleton/initial pose to create walk clip...");
            return null;
        }
        console.log("Creating walk cycle clip (Duration 0.7s)..."); // Log duration change
        // Pass all required arguments, including a shorter duration
        return createWalkCycleClip(
             skeletonRef.current, 
             initialPose, 
             defaultFightStanceTargets, // Pass stance targets
             'WalkCycle', // Clip name
             0.7 // Explicitly set a shorter duration
        );
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

    // --- Setup Animation Actions --- 
    const animationsToUse = useMemo(() => {
        const clips = [];
        if (walkCycleClip) clips.push(walkCycleClip);
        if (fightStanceClip) clips.push(fightStanceClip);
        if (idleBreathClip) clips.push(idleBreathClip);
        if (rightPunchClip) clips.push(rightPunchClip);
        if (duckPoseClip) clips.push(duckPoseClip);
        return clips;
    }, [walkCycleClip, fightStanceClip, idleBreathClip, rightPunchClip, duckPoseClip]);

    const { actions, mixer } = useAnimations(animationsToUse, groupRef); // Use internal groupRef here

    // --- Configure Animation Actions --- 
    useEffect(() => {
        let walkSet = false, stanceSet = false, idleSet = false;
        if (actions?.WalkCycle) {
            actions.WalkCycle.setLoop(THREE.LoopRepeat, Infinity);
            walkSet = true;
        }
        if (actions?.GoToFightStance) {
            actions.GoToFightStance.setLoop(THREE.LoopOnce, 1);
            actions.GoToFightStance.clampWhenFinished = true;
            stanceSet = true;
            // --- Trigger Initial Stance Here (Keep Disabled) ---
            /*
            if (!hasHitGround.current) { // Prevent triggering again if component re-renders
                console.log("Initial setup: triggering fight stance.");
                actions.GoToFightStance.reset().fadeIn(0.2).play();
                hasHitGround.current = true; // Use this flag to mark initial stance trigger
            }
            */
        }
        if (actions?.IdleBreath) {
            actions.IdleBreath.setLoop(THREE.LoopRepeat, Infinity);
            idleSet = true;
            // --- Play Idle Directly if Stance Disabled ---
            // If stance animation is not being played initially, play idle directly
            if (!stanceSet || !hasHitGround.current) { // Check if stance didn't run
                 console.log("Initial setup: triggering IdleBreath directly.");
                 actions.IdleBreath.reset().fadeIn(0.2).play();
                 isInStance.current = true; // Mark as in idle state
                 hasHitGround.current = true; // Prevent re-triggering
            }
        }
        if (actions?.RightPunch) {
            actions.RightPunch.setLoop(THREE.LoopOnce, 1);
            actions.RightPunch.clampWhenFinished = true;
        }
        if (actions?.DuckPose) {
            actions.DuckPose.setLoop(THREE.LoopOnce, 1);
            actions.DuckPose.clampWhenFinished = true;
        }
        if (walkSet || stanceSet || idleSet) {
             console.log(`Animation loops configured: Walk=${walkSet}, Stance=${stanceSet}, Idle=${idleSet}`);
        }
        if (mixer) mixer.timeScale = 1;
    }, [actions, mixer]);

    // --- Mixer Finished Listener for Stance->Idle Transition --- 
    useEffect(() => {
        if (!mixer) return;
        const listener = (e: AnimationFinishedEvent) => {
            // Remove the check for GoToFightStance finishing
            /*
            if (e.action === actions?.GoToFightStance) {
                 console.log("GoToFightStance finished. Starting IdleBreath.");
                actions?.IdleBreath?.reset().fadeIn(0.3).play();
                isInStance.current = true; // Now officially in stance/idle
            } else */
            if (e.action === actions?.RightPunch) { // Only check for punch now
                console.log("RightPunch finished. Starting IdleBreath.");
                actions?.IdleBreath?.reset().fadeIn(0.3).play();
                isActionInProgress.current = false; // Action finished
            }
            // Note: DuckPose clamps, so it won't emit 'finished' unless looping/not clamping
            // We handle duck exit on keyup instead.
        };
        mixer.addEventListener('finished', listener);
        return () => mixer.removeEventListener('finished', listener);
    }, [mixer, actions]);

    // --- Effect to Handle Action Triggers (Punch, Duck Down/Up) ---
    useEffect(() => {
        const idleAction = actions?.IdleBreath;
        const walkAction = actions?.WalkCycle;
        const punchAction = actions?.RightPunch;
        const duckAction = actions?.DuckPose;

        // --- Handle Ducking START ---
        if (pressedKeys.duck) {
            // Only start duck if nothing else is happening (or if duck isn't already playing/clamped)
            // Check weight to prevent restarting if already ducking/clamped
            if (!isActionInProgress.current || (duckAction && duckAction.getEffectiveWeight() === 0)) { 
                console.log("Triggering Duck Pose");
                isActionInProgress.current = true;
                // Fade out others
                idleAction?.fadeOut(0.1);
                walkAction?.fadeOut(0.1);
                punchAction?.fadeOut(0.1); // Should ideally not be playing, but just in case
                // Fade in Duck
                duckAction?.reset().fadeIn(0.2).play();
            }
        }
        // --- Handle Ducking END (Key Release) ---
        // Check if the key is NOT pressed AND the action flag suggests we might be ducking
        // AND the duck animation actually played/is clamped (has weight > 0)
        else if (!pressedKeys.duck && isActionInProgress.current && duckAction && duckAction.getEffectiveWeight() > 0) {
            console.log("Triggering Exit Duck Pose (Key Release)");
            duckAction?.stop(); // Stop playback
            duckAction?.reset(); // Reset state
            if (isInStance.current) { // Only go to idle if stance was reached
                idleAction?.reset().fadeIn(0.3).play();
            }
            // Release the action flag so movement/idle can resume
            isActionInProgress.current = false;
        }
        // --- Handle Punching ---
        // Punch only if not ducking and not already punching/acting
        else if (pressedKeys.punch && !isActionInProgress.current) { 
            console.log("Triggering Right Punch");
            isActionInProgress.current = true;
            // Fade out others
            idleAction?.fadeOut(0.1);
            walkAction?.fadeOut(0.1);
            // No need to fade out duck explicitly, handled by !isActionInProgress check
            punchAction?.reset().fadeIn(0.1).play();
        }
        // Note: Punch action finish is handled by the 'finished' listener which sets isActionInProgress = false

    // Only re-run if key presses change, or actions become available.
    // isActionInProgress changes shouldn't trigger this directly.
    }, [pressedKeys.duck, pressedKeys.punch, actions, isInStance]); 

    // --- Frame Update (Manual Movement & Animation Trigger) --- 
    useFrame((state, delta) => { 
        delta = Math.min(delta, 0.05);
        // Use the internal ref for checks within useFrame now, as it's guaranteed to be a RefObject
        const group = groupRef.current;
        if (!group || !isLoaded) return;

        let targetVelocityX = 0;
        // Only calculate velocity from input if player controlled
        if (isPlayerControlled && !isActionInProgress.current) { 
             if (pressedKeys.left || pressedKeys.right) {
                targetVelocityX = pressedKeys.left ? -CHARACTER_WALK_SPEED : CHARACTER_WALK_SPEED;
            }
        }
        manualVelocityRef.current.x = targetVelocityX;
        
        const currentPos = positionRef.current;
        const wasFalling = manualVelocityRef.current.y < -0.01; // Check if falling before gravity
        
        // Apply gravity only if above ground or just hit ground
        if (currentPos.y > GROUND_LEVEL || !hasHitGround.current) {
             manualVelocityRef.current.y -= GRAVITY * delta;
        } else {
             manualVelocityRef.current.y = 0; // Ensure Y velocity is 0 on ground
        }

        currentPos.x += manualVelocityRef.current.x * delta;
        currentPos.y += manualVelocityRef.current.y * delta;
        currentPos.z += manualVelocityRef.current.z * delta; 

        // --- Ground Collision --- (Simplified: just prevent falling through)
        if (currentPos.y <= GROUND_LEVEL) {
            currentPos.y = GROUND_LEVEL;
            manualVelocityRef.current.y = 0; 
            // --- REMOVE Initial Stance Trigger From Here ---
            /*
            if (wasFalling && !hasHitGround.current) {
                 console.log("Hit ground, triggering fight stance.");
                 actions?.GoToFightStance?.reset().fadeIn(0.2).play();
                 hasHitGround.current = true; // Only trigger once
            }
            */
        }
        // Apply position update to the group using the ref
        group.position.copy(currentPos);

        // --- Animation Control (Walk/Idle Trigger - Only for player-controlled) ---
        const isCurrentlyMoving = targetVelocityX !== 0;
        
        if (isPlayerControlled && !isActionInProgress.current && isCurrentlyMoving !== isMovingHorizontally.current) {
            const walkAction = actions?.WalkCycle;
            const idleAction = actions?.IdleBreath;
            
            if (isCurrentlyMoving) {
                // Start Moving
                if (isInStance.current) idleAction?.fadeOut(0.2);
                if (walkAction) { /* console.log("Starting walk"); */ walkAction.reset().fadeIn(0.2).play(); }
            } else {
                // Stop Moving
                walkAction?.fadeOut(0.2);
                if (idleAction && isInStance.current) { /* console.log("Starting idle"); */ idleAction.reset().fadeIn(0.3).play(); }
            }
            isMovingHorizontally.current = isCurrentlyMoving;
        } 

        // Log mixer timeScale for debugging
        // if (mixer) console.log("Mixer timeScale:", mixer.timeScale);
    });

    // --- Render --- 
    if (!isLoaded) { return null; }
    
    // Use the main group callback ref for the group
    return (
        <group ref={mainGroupRefCallback} name="CharacterModelGroup">
            {/* Inner group to apply facing rotation without animation interference */}
            <group ref={modelWrapperRef} name="ModelWrapper">
                 <primitive object={scene} />
            </group>
             {/* Comment out placeholder box */}
             {/* <mesh castShadow receiveShadow>
                 <boxGeometry args={[0.6, 1.8, 0.5]} /> 
                 <meshStandardMaterial color="green" />
             </mesh> */}
        </group>
    );
}));

PlayerCharacter.displayName = 'PlayerCharacter';