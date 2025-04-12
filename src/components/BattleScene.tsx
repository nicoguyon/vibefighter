import React, { Suspense, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
// Removed Environment, no OrbitControls needed
import * as THREE from 'three';
// Import from @react-three/cannon
// Uncomment PlayerCharacter
import { PlayerCharacter } from './PlayerCharacter'; 

// Define stage boundaries
const MIN_X = -8;
const MAX_X = 8;
const CHARACTER_RADIUS = 0.5; // Approx radius for collision
const MIN_SEPARATION = CHARACTER_RADIUS * 2;

// Define starting positions
const PLAYER1_START_POS: [number, number, number] = [-1.5, 0, 0];
const PLAYER2_START_POS: [number, number, number] = [1.5, 0, 0];
const GROUND_LEVEL = 0;

// Camera control constants - Lower Y, keeping straight angle
const MIN_CAM_Z = 2.76;
const MAX_CAM_Z = 4.5;
const CAM_X = 0.11;
const CAM_Y = 0.64;       // Lowered Camera Y 
const CAM_LOOKAT_Y = 0.66 // Matching LookAt Y for straight view
const LERP_FACTOR = 0.1;
const BASE_DISTANCE_FACTOR = 0.3;
const INITIAL_FOV = 50; // Keep FOV constant here for now

// Define the type for the handle exposed by PlayerCharacter
export interface PlayerCharacterHandle {
    getMainGroup: () => THREE.Group | null;
    getModelWrapper: () => THREE.Group | null;
}

interface BattleSceneProps {
    player1ModelUrl: string;
    player2ModelUrl: string;
}

// Remove the physics-based GroundPlane component definition
/*
function GroundPlane(props: any) {
    const [ref] = usePlane(() => ({ 
        rotation: [-Math.PI / 2, 0, 0],
        material: { friction: 0.1 },
        ...props 
    }));
    return (
        <mesh ref={ref} receiveShadow> 
            <planeGeometry args={[50, 50]} />
            <meshStandardMaterial color="grey" /> 
        </mesh>
    );
}
*/

// Comment out TestCube
/*
function TestCube(props: any) {
  const [ref, api] = useBox(() => ({ mass: 1, position: [0, 3, 0], ...props }));

  // Optional interaction example
  // useFrame(() => api.applyLocalForce([0, 0, -10], [0, 0, 0]));

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="blue" />
    </mesh>
  );
}
*/

function SceneContent({ player1ModelUrl, player2ModelUrl }: BattleSceneProps) {
    // Refs now hold the PlayerCharacterHandle type
    const player1Ref = useRef<PlayerCharacterHandle>(null);
    const player2Ref = useRef<PlayerCharacterHandle>(null);
    const controlsRef = useRef<any>(null); // Re-enable Ref for OrbitControls

    // Target vectors for camera lerping (to avoid creating new vectors each frame)
    const targetCamPos = useRef(new THREE.Vector3()).current;
    const targetLookAt = useRef(new THREE.Vector3()).current;

    // Log constants on mount
    useEffect(() => {
        console.log('--- Initial Camera Constants ---');
        console.log(`CAM_Y: ${CAM_Y}, CAM_LOOKAT_Y: ${CAM_LOOKAT_Y}`);
        console.log(`MIN_CAM_Z: ${MIN_CAM_Z}, MAX_CAM_Z: ${MAX_CAM_Z}`);
        console.log(`INITIAL_FOV: ${INITIAL_FOV}`);
        console.log('------------------------------');
    }, []);

    // Callback for OrbitControls change (Commented out)
    /*
    const handleCameraChange = useCallback(() => {
        if (controlsRef.current) {
            const camera = controlsRef.current.object; // Get camera from controls
            const target = controlsRef.current.target; // Get target from controls
            console.log(
                `OrbitControls Change: Cam Pos X=${camera.position.x.toFixed(2)} Y=${camera.position.y.toFixed(2)} Z=${camera.position.z.toFixed(2)}, Target X=${target.x.toFixed(2)} Y=${target.y.toFixed(2)} Z=${target.z.toFixed(2)}`
            );
        }
    }, []);
    */

    useFrame((state, delta) => {
        //console.log("useFrame running");
        const camera = state.camera;

        // Boundary clamping & Ensure Y >= GROUND_LEVEL (Corrected to use getMainGroup)
        const p1Group = player1Ref.current?.getMainGroup();
        const p2Group = player2Ref.current?.getMainGroup();

        if (p1Group) {
            p1Group.position.x = THREE.MathUtils.clamp(p1Group.position.x, MIN_X, MAX_X);
            if (p1Group.position.y < GROUND_LEVEL) p1Group.position.y = GROUND_LEVEL;
        }
        if (p2Group) {
            p2Group.position.x = THREE.MathUtils.clamp(p2Group.position.x, MIN_X, MAX_X);
            if (p2Group.position.y < GROUND_LEVEL) p2Group.position.y = GROUND_LEVEL;
        }

        // Log ref status before the main logic block
        //console.log(`P1 Ref: ${!!p1Group}, P2 Ref: ${!!p2Group}`);

        if (p1Group && p2Group) {
            // Get the model wrappers for rotation
            const p1Wrapper = player1Ref.current!.getModelWrapper(); // Use ! since we checked p1Ref.current above
            const p2Wrapper = player2Ref.current!.getModelWrapper(); // Use ! since we checked p2Ref.current above

            // Check if all necessary groups exist (Wrappers might still be null initially)
            if (!p1Wrapper || !p2Wrapper) return; 

            // --- Make Characters Face Each Other (Re-enabled) ---
            // Apply rotation logic to wrappers
            const angleP1 = Math.atan2(
                p2Group.position.x - p1Group.position.x, 
                p2Group.position.z - p1Group.position.z 
            );
            p1Wrapper.rotation.y = angleP1 - Math.PI / 2; // Offset for P1
            
            const angleP2 = Math.atan2(
                p1Group.position.x - p2Group.position.x, 
                p1Group.position.z - p2Group.position.z
            );
            p2Wrapper.rotation.y = angleP2 - Math.PI / 2; // Offset for P2

            // --- Dynamic Camera Logic (Use main group positions) ---
            const midX = (p1Group.position.x + p2Group.position.x) / 2;
            const distX = Math.abs(p1Group.position.x - p2Group.position.x);
            
            // --- Simple Collision Detection & Resolution ---
            if (distX < MIN_SEPARATION) {
                const overlap = MIN_SEPARATION - distX;
                const pushAmount = overlap / 2;
                const direction = Math.sign(p2Group.position.x - p1Group.position.x);
                
                // Revert to direct position modification
                p1Group.position.x = THREE.MathUtils.clamp(p1Group.position.x - pushAmount * direction, MIN_X, MAX_X);
                p2Group.position.x = THREE.MathUtils.clamp(p2Group.position.x + pushAmount * direction, MIN_X, MAX_X);
                
                // Optional: Log collision
                // console.log(`Collision Detected! Overlap: ${overlap.toFixed(2)}`);
            }

            const targetZ = THREE.MathUtils.clamp(MIN_CAM_Z + distX * BASE_DISTANCE_FACTOR, MIN_CAM_Z, MAX_CAM_Z);

            // Target position calculation (targetCamPos) is no longer used for lerp
            // targetCamPos.set(midX, CAM_Y, targetZ);
            // Target lookAt calculation (targetLookAt) is no longer used for lookAt
            // targetLookAt.set(midX, CAM_LOOKAT_Y, 0);

            // --- Automatic Camera Movement Disabled ---
            // camera.position.lerp(targetCamPos, LERP_FACTOR); // Keep X/Y lerp commented
            // camera.lookAt(targetLookAt); // Keep lookAt commented

            // --- Smoothly Adjust OrbitControls Distance (Attempt 1) ---
            if (controlsRef.current) {
                // Get the camera controlled by OrbitControls
                const controlledCamera = controlsRef.current.object;
                // Lerp its Z position towards the targetZ
                controlledCamera.position.z = THREE.MathUtils.lerp(controlledCamera.position.z, targetZ, LERP_FACTOR);
                // Important: Tell OrbitControls to update based on the changed camera position
                controlsRef.current.update();
            }

            // --- Debug Logging for Z axis ---
            //console.log(`distX: ${distX.toFixed(2)}, targetZ: ${targetZ.toFixed(2)}, actualZ: ${camera.position.z.toFixed(2)}`);
        }
    });

    return (
        <Suspense fallback={null}>
            <color attach="background" args={['#add8e6']} /> 
            
            {/* Re-enable OrbitControls */}
            <OrbitControls
                ref={controlsRef} // Add ref back
                enablePan={false}
                enableZoom={false} // Disable manual zoom to isolate automatic Z adjustment
                enableRotate={false}
                // onChange={handleCameraChange} // (Commented out)
                target={[0, CAM_LOOKAT_Y, 0]} // Explicitly set initial target
            />

            {/* Player 1 */}
            <PlayerCharacter 
                ref={player1Ref}
                modelUrl={player1ModelUrl}
                initialPosition={PLAYER1_START_POS} // Use updated start pos
                initialFacing="right" // Initial facing (will be overridden by frame logic)
                isPlayerControlled={true}
            />

            {/* Player 2 */}
            <PlayerCharacter 
                ref={player2Ref}
                modelUrl={player2ModelUrl} 
                initialPosition={PLAYER2_START_POS} // Use updated start pos
                initialFacing="left" // Initial facing (will be overridden by frame logic)
                isPlayerControlled={false}
            />

            {/* Visual Ground Plane */}
            <mesh 
                rotation={[-Math.PI / 2, 0, 0]} // Rotate plane to be horizontal
                position={[0, GROUND_LEVEL, 0]} // Position slightly below characters if needed, or at 0
                receiveShadow // Allow plane to receive shadows
            >
                <planeGeometry args={[50, 50]} /> {/* Large plane */}
                <meshStandardMaterial color="#808080" /> {/* Simple grey color */}
            </mesh>
            
            {/* Lighting */}
            <ambientLight intensity={0.6} />
            <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
            <directionalLight position={[-10, 10, -5]} intensity={0.5} />
        </Suspense>
    );
}

export function BattleScene({ player1ModelUrl, player2ModelUrl }: BattleSceneProps) {
    return (
        <Canvas
            shadows
            // Adjusted initial camera for lower, straight view
            camera={{ position: [CAM_X, CAM_Y, MIN_CAM_Z + 0.2], fov: INITIAL_FOV }} // Use constants
            style={{ height: '100vh', width: '100vw' }}
        >
            <SceneContent player1ModelUrl={player1ModelUrl} player2ModelUrl={player2ModelUrl} />
        </Canvas>
    );
} 