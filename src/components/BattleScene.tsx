import React, { Suspense, useRef, useEffect, useState, useMemo, memo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
// Removed Environment, no OrbitControls needed
import * as THREE from 'three';
// Import from @react-three/cannon
// Uncomment PlayerCharacter
// Ensure PlayerCharacterHandle is imported correctly and not defined locally
// Pass new props to PlayerCharacter: fightPhase, introAnimationType, startIntroAnimation, canFight, applyInitialRotation
import { PlayerCharacter, PlayerCharacterHandle, InputState, FightPhase } from './PlayerCharacter'; // Import InputState and FightPhase
import HealthBar from './HealthBar'; // Import the HealthBar component
import { AIController } from './AIController'; // Import AIController

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
const CAM_LOOKAT_Y = 1.2 // Matching LookAt Y for straight view
const LERP_FACTOR = 0.1;
const INTRO_CAMERA_SMOOTH_TIME = 0.4; // Approx time for damping transition
const BASE_DISTANCE_FACTOR = 0.3;
const INITIAL_FOV = 50; // Keep FOV constant here for now
const MAX_HEALTH = 1000; // Define max health
const PUNCH_DAMAGE = 100; // Damage per hit
const BLOCK_DAMAGE_MULTIPLIER = 0.1; // 10% damage when blocking
const HIT_DISTANCE = CHARACTER_RADIUS * 2 + 0.3; // Distance threshold for a hit (cylinders touching + small buffer)
const ROTATION_START_POS_TOLERANCE = 0.1; // Tolerance for starting position check
// Re-introduce FLOOR_TEXTURE_REPEAT (or define if removed)
const FLOOR_TEXTURE_REPEAT = 8; 
const VERTICAL_COLLISION_THRESHOLD = 0.5; // Allow jumping over if Y difference > this

// Add FightPhase type/enum (moved to PlayerCharacter.tsx)
// type FightPhase = 'LOADING' | 'INTRO_START' | 'INTRO_P1' | 'INTRO_P2' | 'PRE_FIGHT' | 'READY' | 'FIGHT' | 'GAME_OVER';

// Define available intro animation types (matching clip names or identifiers)
const INTRO_ANIMATION_TYPES = ['Hello', 'ArmsCrossed', 'Bow']; // Example types

// Helper function to pick a random intro animation
const getRandomIntroAnimation = () => INTRO_ANIMATION_TYPES[Math.floor(Math.random() * INTRO_ANIMATION_TYPES.length)];

// Helper function to play sound
const playSound = (url: string | null, volume: number = 1.0) => {
    if (!url) {
        console.warn("[playSound] Attempted to play null URL.");
        return;
    }
    try {
        const audio = new Audio(url);
        audio.volume = Math.max(0, Math.min(1, volume)); // Clamp volume between 0 and 1
        audio.play().catch(error => {
            console.error(`[playSound] Error playing sound from ${url}:`, error);
        });
    } catch (error) {
        console.error(`[playSound] Error creating Audio object for ${url}:`, error);
    }
};

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
    player1Name: string;
    player2Name: string;
    player1NameAudioUrl: string | null; // Add P1 audio URL
    player2NameAudioUrl: string | null; // Add P2 audio URL
    backgroundImageUrl: string;
    floorTextureUrl: string;
    onSceneVisible: () => void; // Add callback prop
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
    isAIActive: boolean;
    backgroundImageUrl: string;
    floorTextureUrl: string;
    fightPhase: FightPhase;
    onSceneReady: () => void;
    p1IntroAnim: string | null;
    p2IntroAnim: string | null;
    player1Health: number;
    player2Health: number;
}

// --- SceneContent Component (Wrapped with memo) ---
const SceneContent: React.FC<SceneContentProps> = memo(({
    player1ModelUrl,
    player2ModelUrl,
    isAIActive,
    backgroundImageUrl,
    floorTextureUrl,
    fightPhase,
    onSceneReady,
    p1IntroAnim,
    p2IntroAnim,
    player1Health,
    player2Health,
}: SceneContentProps) => {
    const player1Ref = useRef<PlayerCharacterHandle>(null);
    const player2Ref = useRef<PlayerCharacterHandle>(null);
    const aiInputRef = useRef<InputState>({ left: false, right: false, punch: false, duck: false, block: false, jump: false });
    const controlsRef = useRef<any>(null);
    const { scene } = useThree();
    const { setPlayer1Health, setPlayer2Health } = useBattleState();

    // --- State ---
    const dynamicRotationHasRun = useRef(false);
    const sceneReadySignaled = useRef(false);
    const [loadedBackgroundTexture, setLoadedBackgroundTexture] = useState<THREE.Texture | null>(null);
    const [loadedFloorTexture, setLoadedFloorTexture] = useState<THREE.Texture | null>(null);
    const [p1Ready, setP1Ready] = useState(false);
    const [p2Ready, setP2Ready] = useState(false);
    const [showReadyText, setShowReadyText] = useState(false);
    const [showFightText, setShowFightText] = useState(false);
    const [winnerName, setWinnerName] = useState<string | null>(null);
    const [showWinnerBanner, setShowWinnerBanner] = useState(false);

    // --- Create materials for the side walls (AFTER texture state) ---
    const leftWallMaterial = useMemo(() => {
        if (!loadedBackgroundTexture) return null;

        // Clone the texture to avoid modifying the original used by the main background
        const mirroredTexture = loadedBackgroundTexture.clone();
        mirroredTexture.wrapS = THREE.MirroredRepeatWrapping; // Use mirrored wrapping horizontally
        mirroredTexture.wrapT = THREE.RepeatWrapping;        // Repeat vertically
        mirroredTexture.repeat.set(1, 1);  // Reset repeat
        mirroredTexture.offset.set(1, 0);  // Start sampling from the right edge (U=1)
        mirroredTexture.needsUpdate = true; // Important: Signal the texture needs update

        return new THREE.MeshBasicMaterial({
            map: mirroredTexture,
            side: THREE.DoubleSide,
            transparent: false,
            depthWrite: false, // Keep behind other objects
        });
    }, [loadedBackgroundTexture]); // Recompute only when the texture loads/changes

    // --- Effect to signal readiness (Textures AND Characters) ---
    useEffect(() => {
        if (loadedBackgroundTexture && loadedFloorTexture && p1Ready && p2Ready && !sceneReadySignaled.current) {
             console.log("[SceneContent] Textures loaded AND Both Characters Ready. Signaling ready to BattleScene.");
             onSceneReady();
             sceneReadySignaled.current = true;
        }
    }, [loadedBackgroundTexture, loadedFloorTexture, p1Ready, p2Ready, onSceneReady]);

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

    useFrame((state, delta) => {
        const { camera } = state;
        // Refs required for ANY logic below
        const p1Group = player1Ref.current?.getMainGroup();
        const p2Group = player2Ref.current?.getMainGroup();

        if (p1Group && p2Group) {
            const p1Wrapper = player1Ref.current!.getModelWrapper();
            const p2Wrapper = player2Ref.current!.getModelWrapper();
            if (!p1Wrapper || !p2Wrapper) return;

            // --- Phase-Specific Character Logic ---
            if (fightPhase === 'PRE_FIGHT') {
                // --- Set Initial Rotation during PRE_FIGHT --- 
                if (player1Ref.current && p1Wrapper) {
                    // console.log("[SceneContent useFrame PRE_FIGHT] Setting Initial P1 Rotation");
                    p1Wrapper.rotation.y = 0; // P1 faces right
                }
                if (player2Ref.current && p2Wrapper) {
                    // console.log("[SceneContent useFrame PRE_FIGHT] Setting Initial P2 Rotation");
                    p2Wrapper.rotation.y = Math.PI; // P2 faces left
                }
            } else if (fightPhase === 'FIGHT') {
                const playersLanded = player1Ref.current?.getHasHitGround() && player2Ref.current?.getHasHitGround();
                if (!playersLanded) return; // Don't run fight logic/camera if players haven't landed

                // --- Character Interaction Logic (Runs during FIGHT) ---
                // Dynamic Facing
                let angleP1 = Math.atan2(p2Group.position.x - p1Group.position.x, p2Group.position.z - p1Group.position.z);
                let angleP2 = Math.atan2(p1Group.position.x - p2Group.position.x, p1Group.position.z - p2Group.position.z);
                const targetP1Rotation = angleP1 - Math.PI / 2;
                const targetP2Rotation = angleP2 - Math.PI / 2;

                // Removed dynamicRotationHasRun ref check as facing is handled continuously

                p1Wrapper.rotation.y = targetP1Rotation;
                p2Wrapper.rotation.y = targetP2Rotation;

                // Collision (Only during fight)
                const distX = Math.abs(p1Group.position.x - p2Group.position.x);
                const distY = Math.abs(p1Group.position.y - p2Group.position.y);
                if (distX < MIN_SEPARATION && distY < VERTICAL_COLLISION_THRESHOLD) {
                    player1Ref.current!.resetVelocityX();
                    player2Ref.current!.resetVelocityX();
                    const midPointX = (p1Group.position.x + p2Group.position.x) / 2;
                    const directionP1 = Math.sign(p1Group.position.x - p2Group.position.x);
                    const correctedP1X = midPointX + (directionP1 * MIN_SEPARATION / 2);
                    const correctedP2X = midPointX - (directionP1 * MIN_SEPARATION / 2);
                    player1Ref.current!.setPositionX(THREE.MathUtils.clamp(correctedP1X, MIN_X, MAX_X));
                    player2Ref.current!.setPositionX(THREE.MathUtils.clamp(correctedP2X, MIN_X, MAX_X));
                }

                // Hit Detection & Damage (Only during fight)
                const p1 = player1Ref.current;
                const p2 = player2Ref.current;
                if (p1 && p2) {
                    const p1Attacking = p1.isAttacking();
                    const p2Attacking = p2.isAttacking();
                    const p1Blocking = p1.isBlocking();
                    const p2Blocking = p2.isBlocking();
                    if (p1Attacking && distX < HIT_DISTANCE && p1.getCanDamage()) {
                        const damage = p2Blocking ? PUNCH_DAMAGE * BLOCK_DAMAGE_MULTIPLIER : PUNCH_DAMAGE;
                        console.log(`HIT: P1 -> P2 ${p2Blocking ? '(Blocked)' : ''} | Damage: ${damage}`);
                        p1.confirmHit();
                        setPlayer2Health(h => Math.max(0, h - damage));
                    }
                    if (p2Attacking && distX < HIT_DISTANCE && p2.getCanDamage()) {
                        const damage = p1Blocking ? PUNCH_DAMAGE * BLOCK_DAMAGE_MULTIPLIER : PUNCH_DAMAGE;
                        console.log(`HIT: P2 -> P1 ${p1Blocking ? '(Blocked)' : ''} | Damage: ${damage}`);
                        p2.confirmHit();
                        setPlayer1Health(h => Math.max(0, h - damage));
                    }
                }
            }

            // --- Dynamic Camera Logic (Runs AFTER phase-specific logic, if camera exists) ---
            if (camera) {
                // Intro phase camera logic
                if (fightPhase === 'INTRO_P1' || fightPhase === 'INTRO_P2') {
                    const introLookAtY = 0.9;
                    const introCamDistance = 1.4;
                    const introCamYOffset = CAM_Y + 0.2;
                    const focusGroup = fightPhase === 'INTRO_P1' ? p1Group : p2Group;
                    const targetFocusPos = new THREE.Vector3(focusGroup.position.x, introLookAtY, focusGroup.position.z);
                    const targetCamPosIntro = new THREE.Vector3(focusGroup.position.x, introCamYOffset, focusGroup.position.z + introCamDistance);

                    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetCamPosIntro.x, INTRO_CAMERA_SMOOTH_TIME, delta);
                    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetCamPosIntro.y, INTRO_CAMERA_SMOOTH_TIME, delta);
                    camera.position.z = THREE.MathUtils.damp(camera.position.z, targetCamPosIntro.z, INTRO_CAMERA_SMOOTH_TIME, delta);
                    camera.lookAt(targetFocusPos);
                }
                // Pre-Fight camera settles into fight view
                else if (fightPhase === 'PRE_FIGHT') {
                    const fightViewMidPointX = (p1Group.position.x + p2Group.position.x) / 2;
                    const fightViewTargetZ = THREE.MathUtils.clamp(MIN_CAM_Z + Math.abs(p1Group.position.x - p2Group.position.x) * BASE_DISTANCE_FACTOR, MIN_CAM_Z, MAX_CAM_Z);
                    const fightViewTargetPos = new THREE.Vector3(fightViewMidPointX, CAM_Y, fightViewTargetZ);

                    camera.position.x = THREE.MathUtils.lerp(camera.position.x, fightViewTargetPos.x, LERP_FACTOR * 1.5);
                    camera.position.y = THREE.MathUtils.lerp(camera.position.y, fightViewTargetPos.y, LERP_FACTOR * 1.5);
                    camera.position.z = THREE.MathUtils.lerp(camera.position.z, fightViewTargetPos.z, LERP_FACTOR * 1.5);
                    camera.lookAt(fightViewMidPointX, CAM_LOOKAT_Y, 0);
                }
                // Fight/Game Over camera logic (dynamic follow)
                else if (fightPhase === 'FIGHT' || fightPhase === 'GAME_OVER') {
                    const playersLanded = player1Ref.current?.getHasHitGround() && player2Ref.current?.getHasHitGround();
                    if (playersLanded) { // Only update if players are on the ground
                        const cameraDistX = Math.abs(p1Group.position.x - p2Group.position.x);
                        const targetZ = THREE.MathUtils.clamp(MIN_CAM_Z + cameraDistX * BASE_DISTANCE_FACTOR, MIN_CAM_Z, MAX_CAM_Z);
                        const midPointX = (p1Group.position.x + p2Group.position.x) / 2;
                        camera.position.x = THREE.MathUtils.lerp(camera.position.x, midPointX, LERP_FACTOR);
                        camera.position.y = THREE.MathUtils.lerp(camera.position.y, CAM_Y, LERP_FACTOR);
                        camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, LERP_FACTOR);
                        camera.lookAt(midPointX, CAM_LOOKAT_Y, 0);
                    }
                }
                // Always update projection matrix if camera logic ran
                camera.updateProjectionMatrix();
            }
        }
    });

    // Ensure the component returns JSX
    // Add console log for floor texture state before rendering mesh
    console.log(`[SceneContent Render] Floor Texture State: ${loadedFloorTexture ? 'Loaded' : 'Not Loaded'}`, loadedFloorTexture);
    console.log(`[SceneContent Render] Player Ready States: P1=${p1Ready}, P2=${p2Ready}`); // Log player ready state

    return (
        <Suspense fallback={null}>
             <color attach="background" args={['#202020']} />
             <OrbitControls
                 ref={controlsRef}
                 enablePan={false}
                 enableZoom={false}
                 enableRotate={false} // Disable manual rotation
                 target={[0, CAM_LOOKAT_Y, 0]} // Keep initial target reasonable
             />
             {loadedBackgroundTexture && (
                 <>
                 <mesh position={[0, 45/7, -10]} rotation={[0, 0, 0]}>
                     <planeGeometry args={[30, 90/7]} />
                     <meshBasicMaterial
                         map={loadedBackgroundTexture} // Apply texture from state
                         side={THREE.DoubleSide}
                         transparent={false}
                         depthWrite={false} // Keep behind other objects
                     />
                 </mesh>
                 </>
             )}

            {/* Player Characters - Remove onStanceReached prop */}
            <PlayerCharacter
                ref={player1Ref}
                modelUrl={player1ModelUrl}
                initialPosition={PLAYER1_START_POS}
                initialFacing="right"
                isPlayerControlled={true}
                fightPhase={fightPhase}
                introAnimationType={p1IntroAnim}
                startIntroAnimation={fightPhase === 'INTRO_P1'}
                canFight={fightPhase === 'FIGHT'}
                onCharacterReady={() => { setP1Ready(true); }}
                currentHealth={player1Health}
            />
            <PlayerCharacter
                ref={player2Ref}
                modelUrl={player2ModelUrl}
                initialPosition={PLAYER2_START_POS}
                initialFacing="left"
                isPlayerControlled={false}
                externalInput={aiInputRef}
                fightPhase={fightPhase}
                introAnimationType={p2IntroAnim}
                startIntroAnimation={fightPhase === 'INTRO_P2'}
                canFight={fightPhase === 'FIGHT'}
                onCharacterReady={() => { setP2Ready(true); }}
                currentHealth={player2Health}
            />

            <AIController
                playerRef={player2Ref}
                opponentRef={player1Ref}
                isActive={isAIActive} // Use the prop passed down
                aiInputRef={aiInputRef}
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

            {/* Left Side Wall */}
            {leftWallMaterial && (
                <mesh position={[-15, 45/7, 0]} rotation={[0, Math.PI / 2, 0]} material={leftWallMaterial}>
                    <planeGeometry args={[20, 90/7]} />
                </mesh>
            )}

            {/* Right Side Wall */}
            {leftWallMaterial && (
                <mesh position={[15, 45/7, 0]} rotation={[0, -Math.PI / 2, 0]} material={leftWallMaterial}>
                    <planeGeometry args={[20, 90/7]} />
                </mesh>
            )}
        </Suspense>
    );
}); // Close memo wrapper

// --- BattleScene Component (Exported - Manages State & Renders Canvas + UI) ---
export function BattleScene({
    player1ModelUrl,
    player2ModelUrl,
    player1Name,
    player2Name,
    player1NameAudioUrl,
    player2NameAudioUrl,
    backgroundImageUrl,
    floorTextureUrl,
    onSceneVisible
}: BattleSceneProps) {
    const [player1Health, setPlayer1Health] = useState(MAX_HEALTH);
    const [player2Health, setPlayer2Health] = useState(MAX_HEALTH);
    const [isAIEnabled, setIsAIEnabled] = useState(false);
    const [fightPhase, setFightPhase] = useState<FightPhase>('LOADING');
    const [p1IntroAnim, setP1IntroAnim] = useState<string | null>(null);
    const [p2IntroAnim, setP2IntroAnim] = useState<string | null>(null);
    const [showReadyText, setShowReadyText] = useState(false);
    const [showFightText, setShowFightText] = useState(false);
    const [winnerName, setWinnerName] = useState<string | null>(null);
    const [showWinnerBanner, setShowWinnerBanner] = useState(false);

    const battleStateValue = { player1Health, setPlayer1Health, player2Health, setPlayer2Health };

    const versusSoundUrl = '/sounds/voices/versus.mp3';
    const readySoundUrl = '/sounds/voices/ready.mp3';
    const fightSoundUrl = '/sounds/voices/fight.mp3';
    const youWinSoundUrl = '/sounds/voices/you_win.mp3';
    const youLoseSoundUrl = '/sounds/voices/you_lose.mp3';

    // --- Effect to manage Fight Phase transitions & Play Sounds --- //
    useEffect(() => {
        console.log(`[BattleScene] Fight Phase Changed: ${fightPhase}`);
        let phaseTimer: NodeJS.Timeout | undefined;
        let soundDelayTimer: NodeJS.Timeout | undefined;

        // Clear any pending sound delay timer from the previous phase execution
        // (Ensure the cleanup function below handles this correctly)

        switch (fightPhase) {
            case 'INTRO_START':
                setP1IntroAnim(getRandomIntroAnimation());
                setP2IntroAnim(getRandomIntroAnimation());
                phaseTimer = setTimeout(() => setFightPhase('INTRO_P1'), 500);
                break;
            case 'INTRO_P1':
                onSceneVisible(); // Call the callback when P1 intro starts
                playSound(player1NameAudioUrl); // Play P1 name immediately
                // Delay playing "versus" sound
                soundDelayTimer = setTimeout(() => {
                    console.log("[BattleScene] Playing delayed versus sound (2s delay).");
                    playSound(versusSoundUrl);
                }, 2000); // INCREASED DELAY to 2000ms (2 seconds)
                phaseTimer = setTimeout(() => setFightPhase('INTRO_P2'), 4000); // Keep total phase duration the same for now
                break;
            case 'INTRO_P2':
                playSound(player2NameAudioUrl); // Play P2 name immediately
                phaseTimer = setTimeout(() => setFightPhase('PRE_FIGHT'), 4000);
                break;
            case 'PRE_FIGHT':
                console.log("[BattleScene] Entered PRE_FIGHT. Starting 2.2s timer for READY phase...");
                phaseTimer = setTimeout(() => {
                     if (fightPhase === 'PRE_FIGHT') {
                          setFightPhase('READY');
                     }
                 }, 2200);
                break;
            case 'READY':
                playSound(readySoundUrl);
                setShowReadyText(true);
                phaseTimer = setTimeout(() => {
                    setShowReadyText(false);
                    if (fightPhase === 'READY') {
                        setFightPhase('FIGHT');
                    }
                }, 1000);
                break;
            case 'FIGHT':
                playSound(fightSoundUrl);
                setShowFightText(true);
                setIsAIEnabled(true);
                phaseTimer = setTimeout(() => setShowFightText(false), 1000);
                break;
             case 'GAME_OVER':
                 setIsAIEnabled(false);
                 setShowReadyText(false);
                 setShowFightText(false);
                 setShowWinnerBanner(true);
                 if (winnerName === player1Name) {
                     playSound(youWinSoundUrl);
                 } else {
                     playSound(youLoseSoundUrl);
                 }
                 break;
             case 'LOADING':
                 setIsAIEnabled(false);
                 setShowReadyText(false);
                 setShowFightText(false);
                 setP1IntroAnim(null);
                 setP2IntroAnim(null);
                 break;
        }

        // Cleanup function: Clear ALL timers associated with this effect instance
        return () => {
             console.log("[BattleScene] Cleanup: Clearing timers for phase:", fightPhase);
             if (phaseTimer) clearTimeout(phaseTimer);
             if (soundDelayTimer) clearTimeout(soundDelayTimer); // Ensure sound delay timer is cleared
        }
    }, [fightPhase, player1NameAudioUrl, player2NameAudioUrl, versusSoundUrl, readySoundUrl, fightSoundUrl, onSceneVisible, winnerName, player1Name, youWinSoundUrl, youLoseSoundUrl]);

    // --- Effect to check for Game Over ---
    useEffect(() => {
        if (fightPhase === 'FIGHT') {
            let determinedWinner: string | null = null;
            if (player1Health <= 0) {
                determinedWinner = player2Name;
            } else if (player2Health <= 0) {
                determinedWinner = player1Name;
            }

            if (determinedWinner) {
                console.log(`[BattleScene] Game Over! Winner: ${determinedWinner}`);
                setWinnerName(determinedWinner);
                setFightPhase('GAME_OVER');
            }
        }
    }, [player1Health, player2Health, fightPhase, player1Name, player2Name]);

    return (
        <BattleStateContext.Provider value={battleStateValue}>
            <>
                <Canvas
                    shadows
                    // Keep initial camera settings for the default fight view
                    camera={{ position: [CAM_X, CAM_Y, MIN_CAM_Z + 0.2], fov: INITIAL_FOV }}
                    style={{ height: '100%', width: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}
                >
                    <SceneContent
                        player1ModelUrl={player1ModelUrl}
                        player2ModelUrl={player2ModelUrl}
                        isAIActive={isAIEnabled}
                        backgroundImageUrl={backgroundImageUrl}
                        floorTextureUrl={floorTextureUrl}
                        fightPhase={fightPhase}
                        onSceneReady={() => {
                             if (fightPhase === 'LOADING') {
                                 console.log("[BattleScene] SceneContent Textures ready, starting intro sequence.");
                                 setFightPhase('INTRO_START');
                             }
                        }}
                        p1IntroAnim={p1IntroAnim}
                        p2IntroAnim={p2IntroAnim}
                        player1Health={player1Health}
                        player2Health={player2Health}
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

                 {/* --- Ready/Fight Text Overlay --- */}
                 <div style={{
                     position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                     zIndex: 3, pointerEvents: 'none', textAlign: 'center'
                 }}>
                     {showReadyText && <p style={{ fontSize: '4em', color: 'white', fontWeight: 'bold', textShadow: '2px 2px 4px #000000' }}>Ready?</p>}
                     {showFightText && <p style={{ fontSize: '5em', color: 'red', fontWeight: 'bold', textShadow: '3px 3px 6px #000000' }}>FIGHT!</p>}
                     {/* --- Winner Banner --- */}
                    {showWinnerBanner && winnerName && (
                        <p style={{
                            fontSize: '3.5em',
                            color: '#FFD700',
                            fontWeight: 'bold',
                            textShadow: '3px 3px 6px #000000',
                            whiteSpace: 'nowrap'
                        }}>
                            {winnerName}<br></br> Wins!
                        </p>
                    )}
                 </div>

            </>
        </BattleStateContext.Provider>
    );
} 