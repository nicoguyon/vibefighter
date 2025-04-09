import * as THREE from 'three';

// Define EulerOrder type based on Three.js documentation
export type EulerOrder = 'XYZ' | 'YZX' | 'ZXY' | 'XZY' | 'YXZ' | 'ZYX';

// Define InitialPoseData type
export interface InitialPoseData {
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    scale: THREE.Vector3;
}

// Define and export the default fight stance targets
// ONLY include bones that should actively change for the stance.
// Other bones will retain their initial pose.
export const defaultFightStanceTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }> = {
    // Using the values from CharacterViewer.tsx
    // Arms (Order: XYZ)
    'L_Upperarm': { rotation: { x: -6, y: -44, z: -76 }, eulerOrder: 'XYZ' as EulerOrder },
    'L_Forearm':  { rotation: { x: 102, y: -22, z: -34 }, eulerOrder: 'XYZ' as EulerOrder },
    'R_Upperarm': { rotation: { x: -51, y: 32, z: 107 }, eulerOrder: 'XYZ' as EulerOrder },
    'R_Forearm':  { rotation: { x: 51, y: 13, z: 72 }, eulerOrder: 'XYZ' as EulerOrder },
    // Legs (Order: YXZ) - REVERTED TO ORIGINAL VALUES
    'L_Thigh':    { rotation: { x: 2, y: 180, z: -173 }, eulerOrder: 'YXZ' as EulerOrder }, 
    'L_Calf':     { rotation: { x: -6, y: 11, z: -9 }, eulerOrder: 'YXZ' as EulerOrder }, 
    'R_Thigh':    { rotation: { x: 30, y: 166, z: 167 }, eulerOrder: 'YXZ' as EulerOrder }, 
    'R_Calf':     { rotation: { x: 5, y: -21, z: -2 }, eulerOrder: 'YXZ' as EulerOrder }, 
    // Removed Hand, Clavicle, Foot, Pelvis, Waist, Spine, Head defaults
};

/**
 * Creates an animation clip to transition from the initial pose to a target fight stance.
 */
export function createFightStanceClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, InitialPoseData>, 
    boneTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }>, 
    clipName: string = 'FightStance', 
    duration: number = 0.5
): THREE.AnimationClip | null { 
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn("[createFightStanceClip] Missing skeleton or initial pose.");
        return null;
    }
    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration];
    const deg = THREE.MathUtils.degToRad;
    // console.log(`--- Creating Clip: ${clipName} ---`);
    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const targetInfo = boneTargets[boneName];
        const initial = initialPose[boneName];
        if (!initial) { return; } // Skip bone if no initial data
        
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
        }
        
        // Only add track if a target was specified for this bone, or if end is different
        if (targetInfo || !endQuat.equals(startQuat)) {
            tracks.push(new THREE.QuaternionKeyframeTrack(
                `${boneName}.quaternion`, 
                times, 
                [startQuat.x, startQuat.y, startQuat.z, startQuat.w, endQuat.x, endQuat.y, endQuat.z, endQuat.w]
            ));
        }
    });
    
    if (tracks.length === 0) { console.warn(`[createFightStanceClip] No tracks generated for ${clipName}.`); return null; }
    return new THREE.AnimationClip(clipName, duration, tracks);
}

/**
 * Creates an animation clip to transition from the current pose back to the initial pose.
 */
export function createResetPoseClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, InitialPoseData>, 
    duration: number = 0.3
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0) {
         console.warn("[createResetPoseClip] Missing skeleton or initial pose.");
        return null;
    }
    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration];
    let trackAdded = false; // Flag to ensure at least one track

    skeleton.bones.forEach((bone: THREE.Bone) => {
        const initial = initialPose[bone.name];
        if (!initial) return;
        const currentQuat = bone.quaternion;
        
        // Add track if current differs from initial
        if (!currentQuat.equals(initial.quat)) {
            tracks.push(new THREE.QuaternionKeyframeTrack(
                `${bone.name}.quaternion`, 
                times, 
                [currentQuat.x, currentQuat.y, currentQuat.z, currentQuat.w, initial.quat.x, initial.quat.y, initial.quat.z, initial.quat.w]
            ));
            trackAdded = true;
        }
    });

    // Ensure at least one track exists, even if it does nothing, to prevent returning null
    if (!trackAdded) {
        const hipBone = skeleton.bones.find(b => b.name === 'Hip');
        const initialHip = hipBone ? initialPose[hipBone.name] : null;
        if (hipBone && initialHip) {
             tracks.push(new THREE.QuaternionKeyframeTrack(
                 `${hipBone.name}.quaternion`, 
                 times, 
                 [initialHip.quat.x, initialHip.quat.y, initialHip.quat.z, initialHip.quat.w, initialHip.quat.x, initialHip.quat.y, initialHip.quat.z, initialHip.quat.w]
             ));
            console.log("[createResetPoseClip] Pose matched initial, adding dummy Hip track.")
        } else {
            // Fallback if Hip bone isn't found or has no initial pose (shouldn't happen ideally)
            console.warn("[createResetPoseClip] Could not add dummy track as Hip bone/pose was missing.")
            return null; // Return null only in this unlikely fallback case
        }
    }
    
    return new THREE.AnimationClip('ResetPose', duration, tracks);
}

/**
 * Creates a looping idle breathing animation centered around a target stance pose.
 */
export function createIdleBreathClip(
    skeleton: THREE.Skeleton | null, 
    stancePoseTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }>, 
    initialPose: Record<string, InitialPoseData>, 
    clipName: string = 'IdleBreath', 
    duration: number = 3.5, 
    intensity: number = 0.8 
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(stancePoseTargets).length === 0 || Object.keys(initialPose).length === 0) {
        console.warn("[createIdleBreathClip] Missing skeleton, stance targets, or initial pose.");
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration / 2, duration]; 
    const deg = THREE.MathUtils.degToRad;

    const breathingBones = ['Spine01', 'Spine02', 'Head', 'L_Clavicle', 'R_Clavicle', 'L_Upperarm', 'R_Upperarm']; 

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const stanceInfo = stancePoseTargets[boneName];
        const initial = initialPose[boneName];
        
        let baseQuat = new THREE.Quaternion();
        if (stanceInfo?.rotation && stanceInfo.eulerOrder && initial) {
            const eulerOrder = stanceInfo.eulerOrder;
            const r = stanceInfo.rotation;
            const stanceEulerRad = new THREE.Euler(deg(r.x ?? 0), deg(r.y ?? 0), deg(r.z ?? 0), eulerOrder);
            baseQuat.setFromEuler(stanceEulerRad);
        } else if (initial) {
            baseQuat.copy(initial.quat); 
        } else {
            return; 
        }

        if (breathingBones.includes(boneName)) {
            const peakQuat = new THREE.Quaternion(); // Initialize peakQuat
            const deltaEuler = new THREE.Euler();
            const deltaIntensityRad = deg(intensity);

            if (boneName.includes('Spine')) {
                deltaEuler.x = -deltaIntensityRad;
            } else if (boneName.includes('Clavicle')) {
                deltaEuler.y = boneName.startsWith('L_') ? deltaIntensityRad * 0.5 : -deltaIntensityRad * 0.5;
            } else if (boneName.includes('Head')) {
                deltaEuler.x = -deltaIntensityRad * 0.5;
            } else if (boneName.includes('Upperarm')) {
                deltaEuler.z = boneName.startsWith('L_') ? -deltaIntensityRad * 0.3 : deltaIntensityRad * 0.3; 
            }
            
            const deltaQuat = new THREE.Quaternion().setFromEuler(deltaEuler);
            peakQuat.multiplyQuaternions(baseQuat, deltaQuat); // Calculate peak based on base

            tracks.push(new THREE.QuaternionKeyframeTrack(
                `${boneName}.quaternion`, 
                times, 
                [
                    baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w, 
                    peakQuat.x, peakQuat.y, peakQuat.z, peakQuat.w, 
                    baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w
                ]
            ));
        } else {
            // Keep non-breathing bones static at the stance pose
            tracks.push(new THREE.QuaternionKeyframeTrack(
                `${boneName}.quaternion`, 
                [0], 
                [baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w]
            ));
        }
    });

    if (tracks.length === 0) { console.warn(`[createIdleBreathClip] No tracks generated for ${clipName}.`); return null; }
    return new THREE.AnimationClip(clipName, duration, tracks);
} 

/**
 * Creates a looping walk cycle animation.
 * Upper body attempts to hold the stance pose.
 * Legs perform a basic walk cycle.
 */
export function createWalkCycleClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, InitialPoseData>, 
    stancePoseTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }>, 
    clipName: string = 'WalkCycle', 
    duration: number = 1.0, // Duration for one full cycle (two steps)
    stepHeight: number = 5, // How much the thigh lifts vertically on Z axis (degrees)
    strideLength: number = 25, // How far forward/back the thigh swings on X axis (degrees)
    spineTwist: number = 8 // How much the spine twists on Y axis (degrees)
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn("[createWalkCycleClip] Missing skeleton or initial pose.");
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    // Keyframes: 0 = Start, 0.25 = Left leg passing, 0.5 = Left leg forward, 0.75 = Right leg passing, 1.0 = Right leg forward (back to start)
    const times = [0, duration * 0.25, duration * 0.5, duration * 0.75, duration];
    const deg = THREE.MathUtils.degToRad;
    const tmpEuler = new THREE.Euler();
    const tmpQuat = new THREE.Quaternion();

    // Bones groups
    const legBones = ['L_Thigh', 'L_Calf', 'L_Foot', 'R_Thigh', 'R_Calf', 'R_Foot'];
    const spineBone = 'Spine01'; // Target for torso twist
    // Assume all other bones are upper body/head/spine etc.

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const initial = initialPose[boneName];
        if (!initial) return; // Skip bones without initial data

        const stanceInfo = stancePoseTargets[boneName];
        let baseQuat = new THREE.Quaternion(); // Base pose for the bone

        // Determine the base pose (Stance for upper body, Initial for legs - walk modifies from initial)
        if (!legBones.includes(boneName) && stanceInfo?.rotation && stanceInfo.eulerOrder) {
             // Use stance pose for upper body
             tmpEuler.set(deg(stanceInfo.rotation.x ?? 0), deg(stanceInfo.rotation.y ?? 0), deg(stanceInfo.rotation.z ?? 0), stanceInfo.eulerOrder);
             baseQuat.setFromEuler(tmpEuler);
        } else {
            // Use initial pose for legs (or upper body parts not in stance)
            baseQuat.copy(initial.quat);
        }

        // --- Define Keyframe Values --- 
        const values: number[] = [];

        if (legBones.includes(boneName)) {
            // --- Leg Animation --- 
            const isLeft = boneName.startsWith('L_');
            const baseEuler = new THREE.Euler().setFromQuaternion(baseQuat, 'YXZ'); // Use YXZ for legs

            // Calculate keyframe rotations relative to the base pose
            for (let i = 0; i < times.length; i++) {
                const phase = (times[i] / duration) * 2 * Math.PI; // Full cycle phase
                let angleX = baseEuler.x;
                let angleY = baseEuler.y; // Keep base Y rotation
                let angleZ = baseEuler.z; // Keep base Z rotation (usually for twist)

                if (boneName.includes('Thigh')) {
                    // Thigh swing (cosine wave for forward/back)
                    angleX += deg(strideLength * Math.cos(phase + (isLeft ? 0 : Math.PI)) * -1);
                    // Slight lift during passing phase (sine wave, positive only)
                    angleZ += deg(stepHeight * Math.max(0, Math.sin(phase + (isLeft ? 0 : Math.PI) + Math.PI * 0.5)));
                }
                else if (boneName.includes('Calf')) {
                     // Calf bends significantly when leg is back, less when forward
                     // Using cosine: bends most when cos is near 1 (leg back), less when near -1 (leg fwd)
                     const calfBend = deg(45 * (Math.cos(phase + (isLeft ? 0 : Math.PI)) + 1) / 2); // Max bend 45 deg
                     angleX -= calfBend; // Subtract to bend knee backward
                }
                else if (boneName.includes('Foot')) {
                     // Foot points down (plantarflex) when leg back, lifts (dorsiflex) when leg forward
                     const footAngle = deg(25 * Math.cos(phase + (isLeft ? 0 : Math.PI)) * -1); 
                     angleX += footAngle;
                }
                 else { angleX = baseEuler.x; }

                // Convert back to Quaternion
                tmpEuler.set(angleX, angleY, angleZ, 'YXZ');
                tmpQuat.setFromEuler(tmpEuler);
                values.push(tmpQuat.x, tmpQuat.y, tmpQuat.z, tmpQuat.w);
            }
             tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values));

        } else if (boneName === spineBone) {
            // --- Spine Animation --- 
            const baseEuler = new THREE.Euler().setFromQuaternion(baseQuat, 'XYZ'); // Use XYZ for spine
            for (let i = 0; i < times.length; i++) {
                const phase = (times[i] / duration) * 2 * Math.PI;
                // Rotate Y opposite to the leading leg (use sine wave)
                const twist = deg(spineTwist * Math.sin(phase)); // Left leg leads first half
                tmpEuler.set(baseEuler.x, baseEuler.y + twist, baseEuler.z, 'XYZ');
                tmpQuat.setFromEuler(tmpEuler);
                values.push(tmpQuat.x, tmpQuat.y, tmpQuat.z, tmpQuat.w);
            }
            tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values));

        } else {
            // --- Upper Body (Static Stance) --- 
             // Keep upper body static at base (stance) pose
             for (let i = 0; i < times.length; i++) {
                 values.push(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w);
             }
             tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values));
        }
    });

    if (tracks.length === 0) { console.warn(`[createWalkCycleClip] No tracks generated for ${clipName}.`); return null; }
    // Set loop property on the clip itself? No, handled by action.
    return new THREE.AnimationClip(clipName, duration, tracks);
} 

/**
 * Creates a right punch animation.
 * Starts from stance, adds a prep pose, punches, returns towards stance.
 */
export function createRightPunchClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, InitialPoseData>, 
    stancePoseTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }>, 
    clipName: string = 'RightPunch', 
    duration: number = 0.6 // Total duration: prep + extend + retract
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn("[createRightPunchClip] Missing skeleton or initial pose.");
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    // Define timings for the 4 keyframes
    const prepTime = duration * 0.1;
    const apexTime = duration * 0.35; // Original extendDuration
    const times = [0, prepTime, apexTime, duration]; // Start, Prep, Apex, End
    
    const deg = THREE.MathUtils.degToRad;
    const tmpEuler = new THREE.Euler();
    const tmpQuat = new THREE.Quaternion();

    // Key bones involved
    const punchArm = ['R_Upperarm', 'R_Forearm', 'R_Hand'];
    const guardArm = ['L_Upperarm', 'L_Forearm', 'L_Hand'];
    const torsoBones = ['Pelvis', 'Spine01', 'Spine02']; 
    const headBone = 'Head';
    const rightLegBones = ['R_Thigh', 'R_Calf', 'R_Foot'];

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const initial = initialPose[boneName];
        if (!initial) return; 

        const stanceInfo = stancePoseTargets[boneName];
        let baseQuat = new THREE.Quaternion(); 
        let stanceEulerOrder: EulerOrder = 'XYZ'; 

        // Determine base pose and Euler order 
        if (stanceInfo?.rotation && stanceInfo.eulerOrder) {
             stanceEulerOrder = stanceInfo.eulerOrder;
             tmpEuler.set(deg(stanceInfo.rotation.x ?? 0), deg(stanceInfo.rotation.y ?? 0), deg(stanceInfo.rotation.z ?? 0), stanceEulerOrder);
             baseQuat.setFromEuler(tmpEuler);
        } else {
            baseQuat.copy(initial.quat); 
            if (punchArm.includes(boneName) || guardArm.includes(boneName)) stanceEulerOrder = 'XYZ';
            else if ([...torsoBones, headBone].includes(boneName)) stanceEulerOrder = 'XYZ';
            else if (rightLegBones.includes(boneName)) stanceEulerOrder = 'YXZ';
        }
        
        const baseEuler = new THREE.Euler().setFromQuaternion(baseQuat, stanceEulerOrder);
        const keyframeValues: number[] = [];

        // --- Calculate Keyframes --- 
        
        // Frame 0 (time 0): Base Stance Pose
        keyframeValues.push(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w);

        // Frame 1 (time prepTime): Preparatory Pose (Wind-up)
        let prepEuler = new THREE.Euler().copy(baseEuler);
        if (punchArm.includes(boneName)) {
            // Bring arm slightly higher and more bent
             if (boneName === 'R_Upperarm') {
                 prepEuler.x += deg(5);  // Elbow slightly back
                 prepEuler.z += deg(15); // Raise shoulder/arm slightly
             }
             if (boneName === 'R_Forearm') {
                 prepEuler.z += deg(60); // Bend elbow more significantly
             }
             if (boneName === 'R_Hand') {
                 prepEuler.z += deg(10); // Slight wrist bend
             }
        } 
        // Keep other bones at base pose for this frame
        tmpQuat.setFromEuler(prepEuler);
        keyframeValues.push(tmpQuat.x, tmpQuat.y, tmpQuat.z, tmpQuat.w);

        // Frame 2 (time apexTime): Punch Apex (using screenshot values)
        let apexEuler = new THREE.Euler().copy(baseEuler); // Start from base for apex calc
        if (punchArm.includes(boneName)) {
            // --- Set PUNCH Arm Bones Directly from Screenshot Values (XYZ Order) ---
            if (boneName === 'R_Upperarm') {
                apexEuler.set(deg(33), deg(80), deg(68), 'XYZ');
            }
            if (boneName === 'R_Forearm') {
                apexEuler.set(deg(121), deg(-107), deg(108), 'XYZ');
            }
             if (boneName === 'R_Hand') {
                apexEuler.set(deg(-15), deg(67), deg(-17), 'XYZ');
            }
        } else if (guardArm.includes(boneName)) {
            // --- Set GUARD Arm Bones Directly from Screenshot Values (XYZ Order) ---
             if (boneName === 'L_Upperarm') {
                apexEuler.set(deg(15), deg(-40), deg(-72), 'XYZ');
            }
            if (boneName === 'L_Forearm') {
                apexEuler.set(deg(173), deg(66), deg(-55), 'XYZ');
            }
            if (boneName === 'L_Hand') {
                apexEuler.set(deg(0), deg(0), deg(0), 'XYZ'); // From screenshot
            }
        } else if (torsoBones.includes(boneName)) {
            // Rotate torso into punch (relative change from base)
            apexEuler.y += deg(15); // Reduced Twist right
            if (boneName.includes('Spine')) apexEuler.x += deg(5); // Slight forward lean
        } else if (rightLegBones.includes(boneName)) {
            // Slight step/shift forward with right leg (relative change from base)
             if (boneName === 'R_Thigh') {
                 apexEuler.x -= deg(5); // Small step forward
                 apexEuler.y += deg(3); // Slightly turn in
             }
             if (boneName === 'R_Calf') {
                 apexEuler.x -= deg(5); // Adjust calf bend slightly
             }
             if (boneName === 'R_Foot') {
                 apexEuler.x += deg(5); // Keep foot somewhat level
             }
        }
        // Else: Bone not explicitly animated at apex, keep base pose (copied earlier)
        tmpQuat.setFromEuler(apexEuler); 
        keyframeValues.push(tmpQuat.x, tmpQuat.y, tmpQuat.z, tmpQuat.w);

        // Frame 3 (time duration): Return towards Base Stance Pose
        keyframeValues.push(baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w);

        // Add track for this bone
        tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, keyframeValues));
    });

    if (tracks.length === 0) { console.warn(`[createRightPunchClip] No tracks generated for ${clipName}.`); return null; }
    return new THREE.AnimationClip(clipName, duration, tracks);
} 

// Define and export target rotations for the block pose
export const blockTargets: Record<string, { rotation: { x: number; y: number; z: number }, eulerOrder: EulerOrder }> = {
    // Values directly from Leva screenshot
    'L_Upperarm': { rotation: { x: -15, y: -85, z: -68 }, eulerOrder: 'XYZ' },
    'L_Forearm':  { rotation: { x: 0, y: -5, z: -95 }, eulerOrder: 'XYZ' },
    'L_Hand':     { rotation: { x: 0, y: -13, z: 0 }, eulerOrder: 'XYZ' },
    'R_Upperarm': { rotation: { x: 112, y: 41, z: -15 }, eulerOrder: 'XYZ' },
    'R_Forearm':  { rotation: { x: 138, y: 69, z: -95 }, eulerOrder: 'XYZ' },
    'R_Hand':     { rotation: { x: 0, y: 0, z: 0 }, eulerOrder: 'XYZ' },
};

/**
 * Creates a transition animation to a blocking pose.
 * Starts from stance, moves arms to block, holds.
 */
export function createBlockPoseClip(
    skeleton: THREE.Skeleton | null, 
    initialPose: Record<string, InitialPoseData>, 
    stancePoseTargets: Record<string, { rotation?: { x?: number; y?: number; z?: number }, eulerOrder?: EulerOrder }>, 
    clipName: string = 'BlockPose', 
    duration: number = 0.3 // Duration to transition into the pose
): THREE.AnimationClip | null {
    if (!skeleton || Object.keys(initialPose).length === 0) {
        console.warn("[createBlockPoseClip] Missing skeleton or initial pose.");
        return null;
    }

    const tracks: THREE.KeyframeTrack[] = [];
    const times = [0, duration]; // Start, End (Hold Block Pose)
    const deg = THREE.MathUtils.degToRad;
    const tmpEuler = new THREE.Euler();
    const tmpQuat = new THREE.Quaternion();

    // Use the exported blockTargets constant
    // const blockTargets = { ... }; // Removed local definition

    skeleton.bones.forEach(bone => {
        const boneName = bone.name;
        const initial = initialPose[boneName];
        if (!initial) return; 

        const stanceInfo = stancePoseTargets[boneName];
        let startQuat = new THREE.Quaternion(); 
        let startEulerOrder: EulerOrder = 'XYZ';

        // Determine start pose (Stance if defined, else Initial)
        if (stanceInfo?.rotation && stanceInfo.eulerOrder) {
            startEulerOrder = stanceInfo.eulerOrder;
            tmpEuler.set(deg(stanceInfo.rotation.x ?? 0), deg(stanceInfo.rotation.y ?? 0), deg(stanceInfo.rotation.z ?? 0), startEulerOrder);
            startQuat.setFromEuler(tmpEuler);
        } else {
            startQuat.copy(initial.quat);
             // Guess order for initial if needed (less critical here as we mainly use stance)
             if (boneName.includes('Upperarm') || boneName.includes('Forearm') || boneName.includes('Hand')) startEulerOrder = 'XYZ';
             else if (boneName.includes('Thigh') || boneName.includes('Calf') || boneName.includes('Foot')) startEulerOrder = 'YXZ';
             else startEulerOrder = 'XYZ'; // Default for torso/head
        }

        let endQuat = new THREE.Quaternion();
        const blockTarget = blockTargets[boneName];

        // Determine end pose (Block Target if defined, else Start Pose)
        if (blockTarget) {
            const bt = blockTarget.rotation;
            tmpEuler.set(deg(bt.x), deg(bt.y), deg(bt.z), blockTarget.eulerOrder);
            endQuat.setFromEuler(tmpEuler);
        } else {
            endQuat.copy(startQuat); // Keep non-blocking bones at their start/stance pose
        }

        // Add track for this bone
        const keyframeValues = [
            startQuat.x, startQuat.y, startQuat.z, startQuat.w,
            endQuat.x, endQuat.y, endQuat.z, endQuat.w
        ];
        tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, keyframeValues));
    });

    if (tracks.length === 0) { console.warn(`[createBlockPoseClip] No tracks generated for ${clipName}.`); return null; }
    // This clip transitions *to* the pose. The action using it might loop or clamp.
    return new THREE.AnimationClip(clipName, duration, tracks);
} 