import React, { Suspense, useRef, useEffect, useState, useMemo, memo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
// Removed Environment, no OrbitControls needed
import * as THREE from 'three';
// Import from @react-three/cannon
// Uncomment PlayerCharacter
// Ensure PlayerCharacterHandle is imported correctly and not defined locally
import { PlayerCharacter, PlayerCharacterHandle } from './PlayerCharacter'; 
import HealthBar from './HealthBar'; // Import the HealthBar component

// Define stage boundaries
const MIN_X = -8;
const MAX_X = 8;
const CHARACTER_RADIUS = 0.09; // Match debug cylinder radius
const MIN_SEPARATION = CHARACTER_RADIUS * 2;

// Define starting positions
const PLAYER1_START_POS: [number, number, number] = [-1.5, 0, 0];
const PLAYER2_START_POS: [number, number, number] = [1.5, 0, 0];
const GROUND_LEVEL = 0;

// Camera control constants - Lower Y, keeping straight angle
const MIN_CAM_Z = 2.76;
const MAX_CAM_Z = 4.5;
const CAM_X = 0.11;
const CAM_Y = 0.31;       // Lowered Camera Y 
const CAM_LOOKAT_Y = 1.1 // Matching LookAt Y for straight view
const LERP_FACTOR = 0.1;
const BASE_DISTANCE_FACTOR = 0.3;
const INITIAL_FOV = 50; // Keep FOV constant here for now
const MAX_HEALTH = 1000; // Define max health
const PUNCH_DAMAGE = 10; // Damage per hit
const BLOCK_DAMAGE_MULTIPLIER = 0.1; // 10% damage when blocking
const HIT_DISTANCE = CHARACTER_RADIUS * 2 + 0.3; // Distance threshold for a hit (cylinders touching + small buffer)
// Re-introduce FLOOR_TEXTURE_REPEAT (or define if removed)
const FLOOR_TEXTURE_REPEAT = 8; 

// REMOVED Local definition of PlayerCharacterHandle
// export interface PlayerCharacterHandle {
//     getMainGroup: () => THREE.Group | null;
//     getModelWrapper: () => THREE.Group | null;
//     setPositionX: (x: number) => void;
//     resetVelocityX: () => void;
//     getHasHitGround: () => boolean;
// }

interface BattleSceneProps {
    player1ModelUrl: string;
    player2ModelUrl: string;
    player1Name: string; // Add names to props
    player2Name: string;
    backgroundImageUrl: string; // Add background URL prop
    // Add floorTextureUrl prop back
    floorTextureUrl: string;    
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

// --- Create a simple context for Battle State ---
interface BattleStateContextProps {
    player1Health: number;
    setPlayer1Health: React.Dispatch<React.SetStateAction<number>>;
    player2Health: number;
    setPlayer2Health: React.Dispatch<React.SetStateAction<number>>;
}
const BattleStateContext = React.createContext<BattleStateContextProps | undefined>(undefined);

function useBattleState() {
    const context = React.useContext(BattleStateContext);
    if (!context) {
        throw new Error('useBattleState must be used within a BattleStateProvider');
    }
    return context;
}

// --- Props for SceneContent (Internal Component) ---
interface SceneContentProps {
    player1ModelUrl: string;
    player2ModelUrl: string;
    isP2Blocking: boolean;
    backgroundImageUrl: string; // Add background URL prop
    // Add floorTextureUrl prop back
    floorTextureUrl: string;    
}

// --- SceneContent Component (Wrapped with memo) ---
const SceneContent = memo(function SceneContent({ 
    player1ModelUrl, 
    player2ModelUrl, 
    isP2Blocking, 
    backgroundImageUrl, 
    floorTextureUrl // Add prop back to destructuring
}: SceneContentProps) {
    const player1Ref = useRef<PlayerCharacterHandle>(null);
    const player2Ref = useRef<PlayerCharacterHandle>(null);
    const controlsRef = useRef<any>(null);
    const { scene } = useThree(); // Get scene object
    const { setPlayer1Health, setPlayer2Health } = useBattleState();
    const frameCountRef = useRef(0); // Add frame counter ref
    
    // State for manually loaded textures
    const [loadedBackgroundTexture, setLoadedBackgroundTexture] = useState<THREE.Texture | null>(null);
    const [loadedFloorTexture, setLoadedFloorTexture] = useState<THREE.Texture | null>(null); // State for floor texture

    // UseEffect for Background Texture Loading (Manual)
    useEffect(() => {
        console.log("[SceneContent] Manual background texture loading useEffect RUNNING."); 
        const loader = new THREE.TextureLoader();
        setLoadedBackgroundTexture(null); 
        loader.load(
            backgroundImageUrl, 
            (texture) => { 
                console.log("[SceneContent] Background texture MANUALLY loaded.");
                texture.colorSpace = 'srgb'; 
                texture.needsUpdate = true; 
                setLoadedBackgroundTexture(texture);
                // Keep scene.background commented out if plane approach is preferred
                // scene.background = texture; 
                console.log("[SceneContent] Background texture properties set and state updated.");
            },
            undefined, 
            (error) => { console.error("[SceneContent] Error loading background texture manually:", error); }
        );
    }, [backgroundImageUrl, scene]);

    // UseEffect for Floor Texture Loading (Manual)
    useEffect(() => {
        console.log("[SceneContent] Manual floor texture loading useEffect RUNNING.");
        const loader = new THREE.TextureLoader();
        setLoadedFloorTexture(null); // Reset on URL change
        loader.load(
            floorTextureUrl,
            (texture) => { // onLoad
                 console.log("[SceneContent] Floor texture MANUALLY loaded.");
                 texture.colorSpace = 'srgb';
                 texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                 texture.repeat.set(FLOOR_TEXTURE_REPEAT, FLOOR_TEXTURE_REPEAT);
                 texture.needsUpdate = true;
                 setLoadedFloorTexture(texture); // Set state
                 console.log("[SceneContent] Floor texture configured and state updated.");
            },
            undefined, // onProgress
            (error) => { console.error("[SceneContent] Error loading floor texture manually:", error); }
        );
    }, [floorTextureUrl]); // Depend only on the URL

    // --- Add useEffect for OrbitControls Logging ---
    /*
    useEffect(() => {
        const controls = controlsRef.current;
        if (!controls) return; // Exit if controls aren't ready

        const logOrbitState = () => {
            const camera = controls.object as THREE.PerspectiveCamera; // Or OrthographicCamera
            console.log(
                `Orbit Change - CamPos: x=${camera.position.x.toFixed(2)}, y=${camera.position.y.toFixed(2)}, z=${camera.position.z.toFixed(2)} | ` +
                `Target: x=${controls.target.x.toFixed(2)}, y=${controls.target.y.toFixed(2)}, z=${controls.target.z.toFixed(2)}`
            );
        };

        // Add listener
        controls.addEventListener('change', logOrbitState);
        console.log("[SceneContent] OrbitControls 'change' listener added.");

        // Cleanup listener on component unmount or controls change
        return () => {
            console.log("[SceneContent] OrbitControls 'change' listener removed.");
            controls.removeEventListener('change', logOrbitState);
        };
        

    }, [controlsRef]); // Re-run effect if controlsRef itself changes (should only be once)
*/

    useFrame((state, delta) => {
        const { camera } = state;
        const p1Group = player1Ref.current?.getMainGroup();
        const p2Group = player2Ref.current?.getMainGroup();

        frameCountRef.current++; // Increment frame count

        // Boundary clamping & Ground level
        if (p1Group) {
            p1Group.position.x = THREE.MathUtils.clamp(p1Group.position.x, MIN_X, MAX_X);
            if (p1Group.position.y < GROUND_LEVEL) p1Group.position.y = GROUND_LEVEL;
        }
        if (p2Group) {
            p2Group.position.x = THREE.MathUtils.clamp(p2Group.position.x, MIN_X, MAX_X);
            if (p2Group.position.y < GROUND_LEVEL) p2Group.position.y = GROUND_LEVEL;
        }

        if (p1Group && p2Group) {
            const p1Wrapper = player1Ref.current!.getModelWrapper();
            const p2Wrapper = player2Ref.current!.getModelWrapper();
            if (!p1Wrapper || !p2Wrapper) return;

            // Make Characters Face Each Other (Only after a few frames)
            if (frameCountRef.current > 5) { // Add condition
                const angleP1 = Math.atan2(p2Group.position.x - p1Group.position.x, p2Group.position.z - p1Group.position.z);
                // --- DEBUG LOGGING for Rotation ---
                // if (player1Ref.current) { // Check ref exists
                //     console.log(`[useFrame Rot] P1 Pos: ${p1Group.position.x.toFixed(2)}, P2 Pos: ${p2Group.position.x.toFixed(2)}`);
                //     console.log(`[useFrame Rot] Setting P1 RotY to: ${(angleP1 - Math.PI / 2).toFixed(2)} (Current: ${p1Wrapper.rotation.y.toFixed(2)})`);
                // }
                // --- END DEBUG LOGGING ---
                p1Wrapper.rotation.y = angleP1 - Math.PI / 2;
                const angleP2 = Math.atan2(p1Group.position.x - p2Group.position.x, p1Group.position.z - p2Group.position.z);
                p2Wrapper.rotation.y = angleP2 - Math.PI / 2;
            }

            // Collision
            const distX = Math.abs(p1Group.position.x - p2Group.position.x);
            if (player1Ref.current?.getHasHitGround() && player2Ref.current?.getHasHitGround() && distX < MIN_SEPARATION) {
                player1Ref.current!.resetVelocityX();
                player2Ref.current!.resetVelocityX();
                const midPointX = (p1Group.position.x + p2Group.position.x) / 2;
                const directionP1 = Math.sign(p1Group.position.x - p2Group.position.x);
                const correctedP1X = midPointX + (directionP1 * MIN_SEPARATION / 2);
                const correctedP2X = midPointX - (directionP1 * MIN_SEPARATION / 2);
                player1Ref.current!.setPositionX(THREE.MathUtils.clamp(correctedP1X, MIN_X, MAX_X));
                player2Ref.current!.setPositionX(THREE.MathUtils.clamp(correctedP2X, MIN_X, MAX_X));
            }

            // Dynamic Camera
            const targetZ = THREE.MathUtils.clamp(MIN_CAM_Z + distX * BASE_DISTANCE_FACTOR, MIN_CAM_Z, MAX_CAM_Z);
            if (controlsRef.current) {
                const controlledCamera = controlsRef.current.object;
                controlledCamera.position.z = THREE.MathUtils.lerp(controlledCamera.position.z, targetZ, LERP_FACTOR);
                controlsRef.current.update();
            }

            // --- Hit Detection & Damage (with Blocking) --- 
            const p1 = player1Ref.current;
            const p2 = player2Ref.current;

            if (p1 && p2) {
                const p1Attacking = p1.isAttacking();
                const p2Attacking = p2.isAttacking();
                const p1Blocking = p1.isBlocking(); 
                const p2Blocking = p2.isBlocking(); 
                
                // Player 1 attacking Player 2
                if (p1Attacking && distX < HIT_DISTANCE && p1.getCanDamage()) {
                    const damage = p2Blocking ? PUNCH_DAMAGE * BLOCK_DAMAGE_MULTIPLIER : PUNCH_DAMAGE;
                    console.log(`HIT: P1 -> P2 ${p2Blocking ? '(Blocked)' : ''} | Damage: ${damage}`);
                    p1.confirmHit(); 
                    setPlayer2Health(h => Math.max(0, h - damage));
                }

                // Player 2 attacking Player 1
                if (p2Attacking && distX < HIT_DISTANCE && p2.getCanDamage()) {
                    const damage = p1Blocking ? PUNCH_DAMAGE * BLOCK_DAMAGE_MULTIPLIER : PUNCH_DAMAGE;
                    console.log(`HIT: P2 -> P1 ${p1Blocking ? '(Blocked)' : ''} | Damage: ${damage}`);
                    p2.confirmHit();
                    setPlayer1Health(h => Math.max(0, h - damage));
                }
            }
        }
    });

    return (
        <Suspense fallback={null}> 
             {/* Fallback background color (can keep or remove) */}
             <color attach="background" args={['#202020']} /> 
             
             <OrbitControls
                 ref={controlsRef}
                 enablePan={false}
                 enableZoom={false}
                 enableRotate={false}
                 target={[0, CAM_LOOKAT_Y, 0]}
             />
              
             {/* Background Plane Mesh - Uncomment and use state texture */}
             {loadedBackgroundTexture && (
                 <mesh position={[0, 45/7, -10]} rotation={[0, 0, 0]}> 
                     <planeGeometry args={[30, 90/7]} /> 
                     <meshBasicMaterial 
                         map={loadedBackgroundTexture} // Apply texture from state
                         side={THREE.DoubleSide} 
                         transparent={false} 
                         depthWrite={false} // Keep behind other objects
                     />
                 </mesh>
             )}

            {/* Player Characters */}
            <PlayerCharacter
                ref={player1Ref}
                modelUrl={player1ModelUrl}
                initialPosition={PLAYER1_START_POS}
                initialFacing="right"
                isPlayerControlled={true}
            />
            <PlayerCharacter
                ref={player2Ref}
                modelUrl={player2ModelUrl}
                initialPosition={PLAYER2_START_POS}
                initialFacing="left"
                isPlayerControlled={false}
                forceBlock={isP2Blocking}
            />
            
            {/* Ground Plane */}
            <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, GROUND_LEVEL, 0]}
                receiveShadow
            >
                <planeGeometry args={[50, 50]} />
                {/* Apply floor texture from state conditionally */}
                {loadedFloorTexture ? (
                     <meshStandardMaterial map={loadedFloorTexture} color="#ffffff" /> 
                ) : (
                     <meshStandardMaterial color="#808080" /> // Fallback while loading
                )}
            </mesh>
            
            {/* Lights */} 
            <ambientLight intensity={0.6} />
            <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
            <directionalLight position={[-10, 10, -5]} intensity={0.5} />
        </Suspense>
    );
}); // Close memo wrapper

// --- BattleScene Component (Exported - Manages State & Renders Canvas + UI) ---
export function BattleScene({ 
    player1ModelUrl, 
    player2ModelUrl, 
    player1Name, 
    player2Name, 
    backgroundImageUrl, 
    floorTextureUrl // Add prop back
}: BattleSceneProps) {
    const [player1Health, setPlayer1Health] = useState(MAX_HEALTH);
    const [player2Health, setPlayer2Health] = useState(MAX_HEALTH);
    const [isP2Blocking, setIsP2Blocking] = useState(false); 

    const battleStateValue = { player1Health, setPlayer1Health, player2Health, setPlayer2Health };

    const toggleP2Block = () => setIsP2Blocking(prev => !prev); // Debug func

    return (
        <BattleStateContext.Provider value={battleStateValue}>
            <> 
                <Canvas
                    shadows
                    camera={{ position: [CAM_X, CAM_Y, MIN_CAM_Z + 0.2], fov: INITIAL_FOV }}
                    style={{ height: '100%', width: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}
                >
                    {/* Pass ALL props down to SceneContent */}
                    <SceneContent
                        player1ModelUrl={player1ModelUrl}
                        player2ModelUrl={player2ModelUrl}
                        isP2Blocking={isP2Blocking}
                        backgroundImageUrl={backgroundImageUrl}
                        floorTextureUrl={floorTextureUrl} // Pass prop down
                    />
                </Canvas>

                {/* UI Overlay */}
                 <div style={{
                     position: 'absolute', top: 0, left: 0, width: '100%', 
                     padding: '20px', boxSizing: 'border-box', pointerEvents: 'none', 
                     zIndex: 2, display: 'flex', justifyContent: 'space-between', 
                     alignItems: 'flex-start' 
                 }}>
                    <HealthBar name={player1Name} currentHealth={player1Health} maxHealth={MAX_HEALTH} alignment="left" style={{ position: 'relative' }} />
                    <HealthBar name={player2Name} currentHealth={player2Health} maxHealth={MAX_HEALTH} alignment="right" style={{ position: 'relative' }} />
                </div>
                 {/* Optional Debug Button 
                 <button onClick={toggleP2Block} style={{position: 'absolute', bottom: '10px', left: '10px', zIndex: 3, pointerEvents: 'all'}}>Toggle P2 Block</button> 
                 */} 
            </>
        </BattleStateContext.Provider>
    );
} 