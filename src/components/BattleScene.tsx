import React, { Suspense, useRef, useEffect, useState, useMemo, memo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
// Removed Environment, no OrbitControls needed
import * as THREE from 'three';
import { useTexture } from '@react-three/drei'; // <-- Add useTexture import
// Import from @react-three/cannon
// Uncomment PlayerCharacter
// Ensure PlayerCharacterHandle is imported correctly and not defined locally
// Pass new props to PlayerCharacter: fightPhase, introAnimationType, startIntroAnimation, canFight, applyInitialRotation
import { PlayerCharacter, PlayerCharacterHandle, InputState, FightPhase } from './PlayerCharacter'; // Import InputState and FightPhase
import HealthBar from './HealthBar'; // Import the HealthBar component
import { AIController } from './AIController'; // Import AIController
import { playSoundEffect } from '@/utils/playSoundEffect'; // <-- Import sound utility
import { useRouter } from 'next/navigation';             // <-- Import router

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
const PUNCH_DAMAGE = 20; // Damage per hit
const BLOCK_DAMAGE_MULTIPLIER = 0.1; // 10% damage when blocking
const HIT_DISTANCE = CHARACTER_RADIUS * 2 + 0.3; // Distance threshold for a hit (cylinders touching + small buffer)
const ROTATION_START_POS_TOLERANCE = 0.1; // Tolerance for starting position check
// Re-introduce FLOOR_TEXTURE_REPEAT (or define if removed)
const FLOOR_TEXTURE_REPEAT = 8; 
const VERTICAL_COLLISION_THRESHOLD = 0.5; // Allow jumping over if Y difference > this

// --- ADD Projectile Constants ---
const INITIAL_PROJECTILE_SCALE = 0.01;
const BASE_PLANE_SIZE = 0.35; // <-- Reduced Size // Base size of the projectile plane
const GROWTH_DURATION_MS = 500; // Duration for projectile growth (in ms)

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

// Define the callback prop type for launching projectiles
type LaunchProjectileCallback = (
    startPosition: THREE.Vector3,
    directionX: number, // 1 for right, -1 for left
    textureUrl: string | null,
    launcherIndex: 1 | 2 // <-- Add launcher index
) => void;

interface BattleSceneProps {
    player1Id: string; // <-- Add player 1 ID prop
    player1ModelUrl: string;
    player2ModelUrl: string;
    player1Name: string;
    player2Name: string;
    player1NameAudioUrl: string | null; // Add P1 audio URL
    player2NameAudioUrl: string | null; // Add P2 audio URL
    player1SpecialImageUrl: string | null; // <-- Add P1 special image URL prop
    player2SpecialImageUrl: string | null; // <-- Add P2 special image URL prop
    backgroundImageUrl: string;
    floorTextureUrl: string;
    onSceneVisible: () => void; // Add callback prop
}

// --- Create a simple context for Battle State ---
interface BattleStateContextProps {
    player1Health: number;
    setPlayer1Health: React.Dispatch<React.SetStateAction<number>>;
    player2Health: number;
    setPlayer2Health: React.Dispatch<React.SetStateAction<number>>;
    player1Energy: number;
    setPlayer1Energy: React.Dispatch<React.SetStateAction<number>>;
    player2Energy: number;
    setPlayer2Energy: React.Dispatch<React.SetStateAction<number>>;
}
const BattleStateContext = React.createContext<BattleStateContextProps | undefined>(undefined);

// --- MOVE useBattleState OUTSIDE the main component ---
function useBattleState() {
    const context = React.useContext(BattleStateContext);
    if (!context) {
        throw new Error('useBattleState must be used within a BattleStateProvider');
    }
    return context;
}

// -------- Special Power Projectile Component Definition (within BattleScene.tsx) --------
interface SpecialPowerProjectileProps {
  position: THREE.Vector3;
  textureUrl: string | null;
  isFlipped: boolean; // Determine flip based on launch direction
  scale: THREE.Vector3; // Add scale prop
}

const SpecialPowerProjectileComponent: React.FC<SpecialPowerProjectileProps> = memo(function SpecialPowerProjectileComponentProps({
  position,
  textureUrl,
  isFlipped,
  scale, // Receive scale prop
}: SpecialPowerProjectileProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const loadedTexture = useTexture(textureUrl || '');

  useEffect(() => {
    if (loadedTexture && meshRef.current) {
      loadedTexture.wrapS = THREE.RepeatWrapping;
      loadedTexture.repeat.x = isFlipped ? -1 : 1;
      loadedTexture.offset.x = isFlipped ? 1 : 0;
      loadedTexture.needsUpdate = true;
      const material = meshRef.current.material as THREE.MeshBasicMaterial;
      if (material && material.needsUpdate !== undefined) {
          material.needsUpdate = true;
      }
    }
  }, [loadedTexture, isFlipped]);

  // Only render if the URL was provided and the texture has loaded
  if (!textureUrl || !loadedTexture) {
    return null;
  }

  // Calculate aspect ratio based on the loaded texture
  const aspect = loadedTexture.image ? loadedTexture.image.width / loadedTexture.image.height : 1;

  return (
    <mesh ref={meshRef} position={position} scale={scale}>
      {/* Geometry args define the base shape (1x1 plane), scale prop handles final size */}
      <planeGeometry args={[aspect, 1]} /> {/* Use aspect ratio in geometry */}
      <meshBasicMaterial
        map={loadedTexture}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
});
// -------- End Special Power Projectile Component Definition --------

// --- Props for SceneContent (Internal Component) ---
interface SceneContentProps {
    player1ModelUrl: string;
    player2ModelUrl: string;
    player1SpecialImageUrl: string | null;
    player2SpecialImageUrl: string | null;
    isAIActive: boolean;
    backgroundImageUrl: string;
    floorTextureUrl: string;
    fightPhase: FightPhase;
    onSceneReady: () => void;
    p1IntroAnim: string | null;
    p2IntroAnim: string | null;
    player1Health: number;
    player2Health: number;
    isPaused: boolean;
    maxEnergy: number;
}

// --- SceneContent Component (Wrapped with memo) ---
const SceneContent: React.FC<SceneContentProps> = memo(function SceneContent({
    player1ModelUrl,
    player2ModelUrl,
    player1SpecialImageUrl,
    player2SpecialImageUrl,
    isAIActive,
    backgroundImageUrl,
    floorTextureUrl,
    fightPhase,
    onSceneReady,
    p1IntroAnim,
    p2IntroAnim,
    player1Health,
    player2Health,
    isPaused,
    maxEnergy,
}: SceneContentProps) {
    const player1Ref = useRef<PlayerCharacterHandle>(null);
    const player2Ref = useRef<PlayerCharacterHandle>(null);
    const aiInputRef = useRef<InputState>({ left: false, right: false, punch: false, duck: false, block: false, jump: false, special: false });
    const controlsRef = useRef<any>(null);
    const { scene, camera } = useThree();
    const { 
        setPlayer1Health, 
        setPlayer2Health, 
        player1Energy,
        setPlayer1Energy,
        player2Energy,
        setPlayer2Energy
    } = useBattleState();

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
    const [frozenCamState, setFrozenCamState] = useState<{ position: THREE.Vector3, target: THREE.Vector3 } | null>(null);

    // --- ADD State for the Active Projectile ---
    interface ActiveProjectile {
        id: number; // Simple ID for key prop
        startX: number; // Store initial X for distance calculation
        position: THREE.Vector3;
        directionX: number;
        textureUrl: string | null;
        startTime: number;
        status: 'growing' | 'throwing'; // Add status
        scale: THREE.Vector3; // Add scale state
        throwStartTime?: number; // Optional throw start time
        launcherIndex: 1 | 2; // <-- Add launcher index
    }
    const [activeProjectile, setActiveProjectile] = useState<ActiveProjectile | null>(null);
    const nextProjectileId = useRef(0);

    // --- Update Launch Handler ---
    const handleProjectileLaunch = useCallback((startPosition: THREE.Vector3, directionX: number, textureUrl: string | null, launcherIndex: 1 | 2) => {
        console.log(`[SceneContent] Launching Projectile:`, { startPosition, directionX, textureUrl, launcherIndex });

        // Create new projectile state
        const newProjectile: ActiveProjectile = {
             id: nextProjectileId.current++,
             startX: startPosition.x, // Store starting X
             position: startPosition.clone(),
             directionX: directionX,
             textureUrl: textureUrl,
             startTime: performance.now(),
             status: 'growing', // Start in growing state
             scale: new THREE.Vector3(INITIAL_PROJECTILE_SCALE, INITIAL_PROJECTILE_SCALE, INITIAL_PROJECTILE_SCALE),
             launcherIndex: launcherIndex, // <-- Store launcher index
        };
        // Log just before setting state
        console.log(`[SceneContent] Setting new projectile state:`, newProjectile);
        setActiveProjectile(newProjectile); // Set the new projectile as active

    }, []);

    // --- Create materials for the side walls (AFTER texture state) ---
    const leftWallMaterial = useMemo(() => {
        if (!loadedBackgroundTexture) return null;
        const mirroredTexture = loadedBackgroundTexture.clone();
        mirroredTexture.wrapS = THREE.MirroredRepeatWrapping;
        mirroredTexture.wrapT = THREE.RepeatWrapping;
        mirroredTexture.repeat.set(1, 1);
        mirroredTexture.offset.set(1, 0);
        mirroredTexture.needsUpdate = true;
        return new THREE.MeshBasicMaterial({
            map: mirroredTexture,
            side: THREE.DoubleSide,
            transparent: false,
            depthWrite: false,
        });
    }, [loadedBackgroundTexture]);

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
        setLoadedFloorTexture(null);
        loader.load(
            floorTextureUrl,
            (texture) => { // onLoad
                 console.log("[SceneContent] Floor texture MANUALLY loaded.");
                 texture.colorSpace = 'srgb';
                 texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                 texture.repeat.set(FLOOR_TEXTURE_REPEAT, FLOOR_TEXTURE_REPEAT);
                 texture.needsUpdate = true;
                 setLoadedFloorTexture(texture);
                 console.log("[SceneContent] Floor texture configured and state updated.");
            },
            undefined, // onProgress
            (error) => { console.error("[SceneContent] Error loading floor texture manually:", error); }
        );
    }, [floorTextureUrl]);

    // --- Effect to capture camera state on pause --- 
    useEffect(() => {
        if (isPaused) {
            const p1Group = player1Ref.current?.getMainGroup();
            const p2Group = player2Ref.current?.getMainGroup();
            let targetX = 0;
            if (p1Group && p2Group) {
                 targetX = (p1Group.position.x + p2Group.position.x) / 2;
            } else if (p1Group) {
                targetX = p1Group.position.x;
            } else if (p2Group) {
                 targetX = p2Group.position.x;
            }
            const currentTarget = new THREE.Vector3(targetX, CAM_LOOKAT_Y, 0);
            const currentPosition = camera.position.clone();
            console.log("[SceneContent] Pausing. Freezing camera at:", { pos: currentPosition, target: currentTarget });
            setFrozenCamState({ position: currentPosition, target: currentTarget });
        } else {
            console.log("[SceneContent] Resuming. Clearing frozen camera state.");
            setFrozenCamState(null);
        }
    }, [isPaused, player1Ref, player2Ref, camera]); // Added camera dependency

    useFrame((state, delta) => {
        if (isPaused && frozenCamState) {
            camera.position.copy(frozenCamState.position);
            camera.lookAt(frozenCamState.target);
            camera.updateProjectionMatrix();
            return;
        }

        // --- ADDED: Update energy states from player refs ---
        if (player1Ref.current) {
            const p1EnergyVal = player1Ref.current.getCurrentEnergy();
            setPlayer1Energy(p1EnergyVal);
        }
        if (player2Ref.current) {
            const p2EnergyVal = player2Ref.current.getCurrentEnergy();
            setPlayer2Energy(p2EnergyVal);
        }
        // --- END ADDED ---

        const p1Group = player1Ref.current?.getMainGroup();
        const p2Group = player2Ref.current?.getMainGroup();

        if (p1Group && p2Group) {
            const p1Wrapper = player1Ref.current!.getModelWrapper();
            const p2Wrapper = player2Ref.current!.getModelWrapper();
            if (!p1Wrapper || !p2Wrapper) return;

            if (fightPhase === 'PRE_FIGHT') {
                if (player1Ref.current && p1Wrapper) {
                    p1Wrapper.rotation.y = 0;
                }
                if (player2Ref.current && p2Wrapper) {
                    p2Wrapper.rotation.y = Math.PI;
                }
            } else if (fightPhase === 'FIGHT') {
                const playersLanded = player1Ref.current?.getHasHitGround() && player2Ref.current?.getHasHitGround();
                if (!playersLanded) return;

                let angleP1 = Math.atan2(p2Group.position.x - p1Group.position.x, p2Group.position.z - p1Group.position.z);
                let angleP2 = Math.atan2(p1Group.position.x - p2Group.position.x, p1Group.position.z - p2Group.position.z);
                const targetP1Rotation = angleP1 - Math.PI / 2;
                const targetP2Rotation = angleP2 - Math.PI / 2;
                p1Wrapper.rotation.y = targetP1Rotation;
                p2Wrapper.rotation.y = targetP2Rotation;

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

                // --- Update Projectile Position & State ---
                if (activeProjectile) {
                    const now = performance.now();
                    // It's generally better to update state via the setter function
                    // We calculate the next state properties here and call setActiveProjectile once at the end.
                    let newStatus = activeProjectile.status;
                    let newScale = activeProjectile.scale.clone();
                    let newPosition = activeProjectile.position.clone();
                    let newThrowStartTime = activeProjectile.throwStartTime;

                    let shouldDeactivate = false; // Flag for deactivation

                    switch (activeProjectile.status) {
                        case 'growing': {
                            const growingElapsedTime = now - activeProjectile.startTime;
                            const growthProgress = Math.min(growingElapsedTime / GROWTH_DURATION_MS, 1);
                            const targetScaleValue = BASE_PLANE_SIZE;
                            
                            // Interpolate scale uniformly (aspect ratio handled by component geometry)
                            const currentScaleValue = THREE.MathUtils.lerp(INITIAL_PROJECTILE_SCALE, targetScaleValue, growthProgress);
                            newScale.set(currentScaleValue, currentScaleValue, currentScaleValue);

                            // Position remains fixed at start during growth
                            newPosition.copy(activeProjectile.position);

                            if (growthProgress === 1) {
                                console.log(`[SceneContent Projectile] Growth Complete for ID ${activeProjectile.id}. Transitioning to throwing.`);
                                newStatus = 'throwing';
                                newThrowStartTime = now; // Record the time throwing starts
                            }
                            break;
                        }
                        case 'throwing': {
                            const projectileSpeed = 3; // Define speed (SLOWER)
                            const MAX_TRAVEL_TIME_MS = 1500; // Define max travel time

                            // Calculate next position for throwing
                            newPosition.x += activeProjectile.directionX * projectileSpeed * delta;

                            // Use throwStartTime if available, otherwise fall back to startTime
                            const throwStartTime = activeProjectile.throwStartTime ?? activeProjectile.startTime;
                            const elapsedTime = now - throwStartTime;

                            if (elapsedTime > MAX_TRAVEL_TIME_MS) {
                                console.log(`[SceneContent Projectile] Deactivating ID ${activeProjectile.id} (Time Limit)`);
                                shouldDeactivate = true;
                            }

                            // --- Projectile Hit Detection --- << REVISED LOGIC
                            // Determine opponent based on who LAUNCHED the projectile
                            const opponentGroup = activeProjectile.launcherIndex === 1 ? p2Group : p1Group;
                            const opponentRef = activeProjectile.launcherIndex === 1 ? player2Ref.current : player1Ref.current;
                            const opponentPlayerIndex = activeProjectile.launcherIndex === 1 ? 2 : 1; // For logging

                            const opponentHitRadius = CHARACTER_RADIUS; // Use character radius
                            const projectileHitRadius = 0.3; // Keep projectile radius
                            const verticalHitTolerance = 1.0; // Generous vertical tolerance

                            // Calculate distances separately
                            const distanceX = Math.abs(newPosition.x - opponentGroup.position.x);
                            const distanceY = Math.abs(newPosition.y - opponentGroup.position.y);
                            const combinedRadiusX = projectileHitRadius + opponentHitRadius;

                            // --- Update Logging ---
                            console.log(`[Projectile Hit Check - ID ${activeProjectile.id} by P${activeProjectile.launcherIndex}]
  Projectile Pos: ${newPosition.x.toFixed(2)}, ${newPosition.y.toFixed(2)}
  Opponent (P${opponentPlayerIndex}) Pos:   ${opponentGroup.position.x.toFixed(2)}, ${opponentGroup.position.y.toFixed(2)}
  Distance X:      ${distanceX.toFixed(3)} (Threshold: ${combinedRadiusX.toFixed(3)})
  Distance Y:      ${distanceY.toFixed(3)} (Tolerance: ${verticalHitTolerance.toFixed(3)})
  X Met:           ${distanceX < combinedRadiusX}
  Y Met:           ${distanceY < verticalHitTolerance}
  Condition Met:   ${distanceX < combinedRadiusX && distanceY < verticalHitTolerance}`);
                            // --- END LOGGING ---

                            // Check BOTH horizontal and vertical proximity
                            if (distanceX < combinedRadiusX && distanceY < verticalHitTolerance) {
                                console.log(`[SceneContent Projectile] HIT DETECTED (X/Y): P${activeProjectile.launcherIndex}'s Projectile (ID ${activeProjectile.id}) vs P${opponentPlayerIndex}`);
                                const opponentBlocking = opponentRef?.isBlocking() ?? false;
                                const damage = opponentBlocking ? 100 * 0.2 : 100; // Apply special damage amounts

                                // --- Trigger Hit Flicker on Opponent --- 
                                opponentRef?.triggerHitFlicker(); // Call flicker on the hit character

                                if (opponentPlayerIndex === 2) { // Hit Player 2
                                    setPlayer2Health(h => Math.max(0, h - damage));
                                } else { // Hit Player 1
                                    setPlayer1Health(h => Math.max(0, h - damage));
                                }
                                playSoundEffect('/sounds/effects/special_hit.mp3');
                                shouldDeactivate = true; // Deactivate on hit
                            }
                            break; // End throwing case
                        }
                    } // End switch

                    // Update the main state only once at the end of the frame logic
                    if (shouldDeactivate) {
                        setActiveProjectile(null); // Deactivate
                    } else {
                        setActiveProjectile({
                            ...activeProjectile,
                            status: newStatus,
                            scale: newScale,
                            position: newPosition,
                            throwStartTime: newThrowStartTime,
                        });
                    }
                } // End if(activeProjectile)

                // --- Standard Hit Detection & Damage --- (Keep existing)
                const p1 = player1Ref.current;
                const p2 = player2Ref.current;
                if (p1 && p2) {
                    const p1GroupPos = p1Group.position;
                    const p2GroupPos = p2Group.position;
                    const distXHit = Math.abs(p1GroupPos.x - p2GroupPos.x);
                    const p1Blocking = p1?.isBlocking() ?? false;
                    const p2Blocking = p2?.isBlocking() ?? false;
                    const playersLandedHit = (p1?.getHasHitGround() ?? false) && (p2?.getHasHitGround() ?? false);
                    const p1AttackingPunchKick = (p1?.isAttacking() ?? false) && !(p1?.isPerformingSpecialAttack() ?? true);
                    const p2AttackingPunchKick = (p2?.isAttacking() ?? false) && !(p2?.isPerformingSpecialAttack() ?? true);
                    const p1CanDamage = p1?.getCanDamage() ?? false;
                    const p2CanDamage = p2?.getCanDamage() ?? false;

                    if (p1AttackingPunchKick && distXHit < HIT_DISTANCE && p1CanDamage && playersLandedHit) {
                        const damage = p2Blocking ? PUNCH_DAMAGE * BLOCK_DAMAGE_MULTIPLIER : PUNCH_DAMAGE;
                        p1.confirmHit(); // Attacker confirms their hit (e.g., to stop their damage window)
                        p2?.triggerHitFlicker(); // Trigger flicker on Player 2 (the one hit)
                        setPlayer2Health(h => Math.max(0, h - damage));
                    }
                    if (p2AttackingPunchKick && distXHit < HIT_DISTANCE && p2CanDamage && playersLandedHit) {
                        const damage = p1Blocking ? PUNCH_DAMAGE * BLOCK_DAMAGE_MULTIPLIER : PUNCH_DAMAGE;
                        p2.confirmHit(); // Attacker confirms their hit
                        p1?.triggerHitFlicker(); // Trigger flicker on Player 1 (the one hit)
                        setPlayer1Health(h => Math.max(0, h - damage));
                    }
                }
            }

            if (camera) {
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
                else if (fightPhase === 'PRE_FIGHT') {
                    const fightViewMidPointX = (p1Group.position.x + p2Group.position.x) / 2;
                    const fightViewTargetZ = THREE.MathUtils.clamp(MIN_CAM_Z + Math.abs(p1Group.position.x - p2Group.position.x) * BASE_DISTANCE_FACTOR, MIN_CAM_Z, MAX_CAM_Z);
                    const fightViewTargetPos = new THREE.Vector3(fightViewMidPointX, CAM_Y, fightViewTargetZ);
                    camera.position.x = THREE.MathUtils.lerp(camera.position.x, fightViewTargetPos.x, LERP_FACTOR * 1.5);
                    camera.position.y = THREE.MathUtils.lerp(camera.position.y, fightViewTargetPos.y, LERP_FACTOR * 1.5);
                    camera.position.z = THREE.MathUtils.lerp(camera.position.z, fightViewTargetPos.z, LERP_FACTOR * 1.5);
                    camera.lookAt(fightViewMidPointX, CAM_LOOKAT_Y, 0);
                }
                else if (fightPhase === 'FIGHT' || fightPhase === 'GAME_OVER') {
                    const playersLanded = player1Ref.current?.getHasHitGround() && player2Ref.current?.getHasHitGround();
                    if (playersLanded) {
                        const cameraDistX = Math.abs(p1Group.position.x - p2Group.position.x);
                        const targetZ = THREE.MathUtils.clamp(MIN_CAM_Z + cameraDistX * BASE_DISTANCE_FACTOR, MIN_CAM_Z, MAX_CAM_Z);
                        const midPointX = (p1Group.position.x + p2Group.position.x) / 2;
                        camera.position.x = THREE.MathUtils.lerp(camera.position.x, midPointX, LERP_FACTOR);
                        camera.position.y = THREE.MathUtils.lerp(camera.position.y, CAM_Y, LERP_FACTOR);
                        camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, LERP_FACTOR);
                        camera.lookAt(midPointX, CAM_LOOKAT_Y, 0);
                    }
                }
                camera.updateProjectionMatrix();
            }
        }
    });

    console.log(`[SceneContent Render] Floor Texture State: ${loadedFloorTexture ? 'Loaded' : 'Not Loaded'}`, loadedFloorTexture);
    console.log(`[SceneContent Render] Player Ready States: P1=${p1Ready}, P2=${p2Ready}`);

    return (
        <Suspense fallback={null}>
             <color attach="background" args={['#202020']} />
             <OrbitControls
                 ref={controlsRef}
                 enablePan={false}
                 enableZoom={false}
                 enableRotate={false}
                 target={[0, CAM_LOOKAT_Y, 0]}
             />
             {loadedBackgroundTexture && (
                 <>
                 <mesh position={[0, 45/7, -10]} rotation={[0, 0, 0]}>
                     <planeGeometry args={[30, 90/7]} />
                     <meshBasicMaterial
                         map={loadedBackgroundTexture}
                         side={THREE.DoubleSide}
                         transparent={false}
                         depthWrite={false}
                     />
                 </mesh>
                 </>
             )}

            {/* Player Characters - Add onLaunchProjectile prop AND playerIndex prop */}
            <>
            {(() => { console.log(`[SceneContent] Rendering PlayerCharacter 1. URL: ${player1ModelUrl}, Facing: right, Phase: ${fightPhase}`); return null; })()}
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
                isPaused={isPaused}
                specialImageUrlProp={player1SpecialImageUrl}
                onLaunchProjectile={handleProjectileLaunch}
                playerIndex={1} // <-- Pass index 1
            />
            </>
            <>
            {(() => { console.log(`[SceneContent] Rendering PlayerCharacter 2. URL: ${player2ModelUrl}, Facing: left, Phase: ${fightPhase}`); return null; })()}
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
                isPaused={isPaused}
                specialImageUrlProp={player2SpecialImageUrl}
                onLaunchProjectile={handleProjectileLaunch}
                playerIndex={2} // <-- Pass index 2
            />
            </>

            <AIController
                playerRef={player2Ref}
                opponentRef={player1Ref}
                isActive={isAIActive}
                aiInputRef={aiInputRef}
                isPaused={isPaused}
            />

            <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, GROUND_LEVEL, 0]}
                receiveShadow
                key={loadedFloorTexture ? loadedFloorTexture.uuid : 'no-floor-texture'}
            >
                <planeGeometry args={[50, 50]} />
                {loadedFloorTexture ? (
                     <meshStandardMaterial map={loadedFloorTexture} color="#ffffff" />
                ) : (
                     <meshStandardMaterial color="#808080" />
                )}
            </mesh>

            <ambientLight intensity={0.6} />
            <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
            <directionalLight position={[-10, 10, -5]} intensity={0.5} />

            {leftWallMaterial && (
                <mesh position={[-15, 45/7, 0]} rotation={[0, Math.PI / 2, 0]} material={leftWallMaterial}>
                    <planeGeometry args={[20, 90/7]} />
                </mesh>
            )}

            {leftWallMaterial && (
                <mesh position={[15, 45/7, 0]} rotation={[0, -Math.PI / 2, 0]} material={leftWallMaterial}>
                    <planeGeometry args={[20, 90/7]} />
                </mesh>
            )}

            {/* --- Render Active Projectile --- */}
            {activeProjectile && activeProjectile.textureUrl ? (
                <SpecialPowerProjectileComponent
                    key={activeProjectile.id}
                    position={activeProjectile.position}
                    textureUrl={activeProjectile.textureUrl}
                    isFlipped={activeProjectile.directionX === -1}
                    scale={activeProjectile.scale}
                />
            ) : null}
        </Suspense>
    );
}); // Close memo wrapper

// --- BattleScene Component (Exported - Manages State & Renders Canvas + UI) ---
export function BattleScene({
    player1Id,
    player1ModelUrl,
    player2ModelUrl,
    player1Name,
    player2Name,
    player1NameAudioUrl,
    player2NameAudioUrl,
    player1SpecialImageUrl,
    player2SpecialImageUrl,
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
    const [isPaused, setIsPaused] = useState(false);
    const [showPauseMenu, setShowPauseMenu] = useState(false);
    const fightStartTriggeredRef = useRef(false);
    const [restartCounter, setRestartCounter] = useState(0);
    const gameOverMenuTimerRef = useRef<NodeJS.Timeout | null>(null);
    const gameOverSequenceInitiatedRef = useRef(false);
    const router = useRouter();

    // --- ADDED: Energy States & Max Energy Constant ---
    const MAX_ENERGY_BATTLESCENE = 100; // Must match PlayerCharacter's MAX_ENERGY
    const [player1Energy, setPlayer1Energy] = useState(MAX_ENERGY_BATTLESCENE);
    const [player2Energy, setPlayer2Energy] = useState(MAX_ENERGY_BATTLESCENE);
    // --- END ADDED ---

    // --- DIAGNOSTIC useEffects ---
    useEffect(() => {
        console.log(`[BattleScene Diagnostics] showPauseMenu state is NOW: ${showPauseMenu}`);
    }, [showPauseMenu]);

    useEffect(() => {
        console.log(`[BattleScene Diagnostics] isPaused state is NOW: ${isPaused}`);
    }, [isPaused]);
    // --- END DIAGNOSTIC useEffects ---

    const battleStateValue: BattleStateContextProps = {
        player1Health, setPlayer1Health, 
        player2Health, setPlayer2Health,
        player1Energy, setPlayer1Energy,
        player2Energy, setPlayer2Energy
    };

    // --- Effect to Reset State on Restart ---
    useEffect(() => {
        if (restartCounter > 0) {
            console.log("[BattleScene] Restart triggered. Resetting states.");
            setPlayer1Health(MAX_HEALTH);
            setPlayer2Health(MAX_HEALTH);
            setIsAIEnabled(false);
            setFightPhase('LOADING');
            setP1IntroAnim(null);
            setP2IntroAnim(null);
            setShowReadyText(false);
            setShowFightText(false);
            setWinnerName(null);
            setShowWinnerBanner(false);
            setIsPaused(false);
            setShowPauseMenu(false);
            fightStartTriggeredRef.current = false;
            gameOverSequenceInitiatedRef.current = false;
            setPlayer1Energy(MAX_ENERGY_BATTLESCENE);
            setPlayer2Energy(MAX_ENERGY_BATTLESCENE);
        }
    }, [restartCounter]);

    const versusSoundUrl = '/sounds/voices/versus.mp3';
    const readySoundUrl = '/sounds/voices/ready.mp3';
    const fightSoundUrl = '/sounds/voices/fight.mp3';
    const winsSoundUrl = '/sounds/voices/wins.mp3';

    // --- Effect to Handle Pause Key Press ---
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                if (fightPhase === 'FIGHT' || fightPhase === 'READY') {
                    setIsPaused((prevPaused) => {
                        const nextPaused = !prevPaused;
                        setShowPauseMenu(nextPaused);
                        if (nextPaused) {
                            playSoundEffect('/sounds/effects/pause.mp3');
                        }
                        console.log(`[BattleScene] Pause Toggled: ${nextPaused}`);
                        return nextPaused;
                    });
                } else {
                    console.log(`[BattleScene] Pause prevented. Fight Phase: ${fightPhase}`);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [fightPhase]);

    // --- Effect to manage Fight Phase transitions & Play Sounds --- //
    useEffect(() => {
        if (isPaused && fightPhase !== 'GAME_OVER') {
            console.log(`[BattleScene Phase Effect] Paused. Skipping transition for phase ${fightPhase}.`);
            return;
        }

        if (fightPhase !== 'GAME_OVER' && gameOverSequenceInitiatedRef.current) {
            console.log('[BattleScene Phase Effect] Exited GAME_OVER, resetting gameOverSequenceInitiatedRef.');
            gameOverSequenceInitiatedRef.current = false;
        }

        console.log(`[BattleScene] Fight Phase Changed: ${fightPhase}`);
        let phaseTimer: NodeJS.Timeout | undefined;
        let soundDelayTimer: NodeJS.Timeout | undefined;

        switch (fightPhase) {
            case 'INTRO_START':
                setP1IntroAnim(getRandomIntroAnimation());
                setP2IntroAnim(getRandomIntroAnimation());
                phaseTimer = setTimeout(() => setFightPhase('INTRO_P1'), 500);
                break;
            case 'INTRO_P1':
                onSceneVisible();
                playSound(player1NameAudioUrl);
                soundDelayTimer = setTimeout(() => {
                    console.log("[BattleScene] Playing delayed versus sound (2s delay).");
                    playSound(versusSoundUrl);
                }, 2000);
                phaseTimer = setTimeout(() => setFightPhase('INTRO_P2'), 4000);
                break;
            case 'INTRO_P2':
                playSound(player2NameAudioUrl);
                phaseTimer = setTimeout(() => setFightPhase('PRE_FIGHT'), 4000);
                break;
            case 'PRE_FIGHT':
                console.log("[BattleScene] Entered PRE_FIGHT. Starting 2.2s timer for READY phase...");
                phaseTimer = setTimeout(() => {
                     if (fightPhase === 'PRE_FIGHT' && !isPaused) {
                          setFightPhase('READY');
                     }
                 }, 2200);
                break;
            case 'READY':
                playSound(readySoundUrl);
                setShowReadyText(true);
                phaseTimer = setTimeout(() => {
                    setShowReadyText(false);
                    if (fightPhase === 'READY' && !isPaused) {
                        console.log("[BattleScene Phase Effect - READY timeout] Conditions met. Playing sound, enabling AI, setting ref, setting phase to FIGHT.");
                        playSound(fightSoundUrl);
                        setIsAIEnabled(true);
                        fightStartTriggeredRef.current = true;
                        setFightPhase('FIGHT');
                    }
                }, 1000);
                break;
            case 'FIGHT':
                console.log(`[BattleScene Phase Effect - FIGHT] Entering. IsPaused: ${isPaused}, Winner: ${winnerName}`);
                if (fightStartTriggeredRef.current) {
                    setShowFightText(true);
                    phaseTimer = setTimeout(() => setShowFightText(false), 1000);
                    fightStartTriggeredRef.current = false;
                }
                if (!isPaused && !winnerName) {
                    setIsAIEnabled(true);
                } else {
                    console.log(`[BattleScene Phase Effect - FIGHT] Conditions NOT met or resuming. IsPaused: ${isPaused}, fightStartTriggeredRef: ${fightStartTriggeredRef.current}, Winner: ${winnerName}`);
                    if (!winnerName) {
                        setIsAIEnabled(true);
                    }
                }
                break;
             case 'GAME_OVER':
                 // Log entry and the ref state
                console.log(`[BattleScene GAME_OVER Check] Current fightPhase: ${fightPhase}, gameOverSequenceInitiatedRef: ${gameOverSequenceInitiatedRef.current}, winnerName: ${winnerName}`);

                 if (!gameOverSequenceInitiatedRef.current) {
                    console.log('[BattleScene GAME_OVER] Initiating game over sequence (gameOverSequenceInitiatedRef was false).');
                    gameOverSequenceInitiatedRef.current = true;

                    setIsAIEnabled(false);
                    setShowReadyText(false);
                    setShowFightText(false);
                    setShowWinnerBanner(true);
                    const winnerAudioUrl = winnerName === player1Name ? player1NameAudioUrl : player2NameAudioUrl;
                    let winsSoundPlayed = false;
                    const playWinsAndStartTimer = () => {
                        // Log entry to this function and winsSoundPlayed state
                        console.log(`[BattleScene playWinsAndStartTimer] Entered. winsSoundPlayed: ${winsSoundPlayed}`);
                        if (winsSoundPlayed) {
                            console.log(`[BattleScene playWinsAndStartTimer] Exiting because winsSoundPlayed is true.`);
                            return;
                        }
                        winsSoundPlayed = true;
                        console.log("[BattleScene GAME_OVER] Playing wins sound.");
                        playSound(winsSoundUrl);
                        console.log("[BattleScene GAME_OVER] Preparing to set 5s timer for Game Over menu.");
                        if (gameOverMenuTimerRef.current) {
                            clearTimeout(gameOverMenuTimerRef.current);
                            console.log("[BattleScene GAME_OVER] Cleared existing gameOverMenuTimerRef.");
                        }
                        gameOverMenuTimerRef.current = setTimeout(() => {
                            // Log entry to timeout callback and current fightPhase
                            console.log(`[BattleScene GAME_OVER Timer Callback] Entered. Current fightPhase: ${fightPhase}. Menu should appear now.`);
                            if (fightPhase === 'GAME_OVER') { // Check the fightPhase *at the time of execution*
                                console.log("[BattleScene GAME_OVER Timer Callback] Condition met (fightPhase is GAME_OVER). Setting isPaused and showPauseMenu to true.");
                                setIsPaused(true);
                                setShowPauseMenu(true);
                            } else {
                                console.log(`[BattleScene GAME_OVER Timer Callback] Condition NOT met. fightPhase is now: ${fightPhase}. Menu will NOT appear.`);
                            }
                            gameOverMenuTimerRef.current = null; // Clear the ref
                        }, 5000);
                        console.log("[BattleScene GAME_OVER] 5s timer for Game Over menu SET.");
                    };

                    if (winnerAudioUrl) {
                        try {
                            const nameAudio = new Audio(winnerAudioUrl);
                            nameAudio.onended = () => {
                                console.log(`[BattleScene] Winner name audio finished for ${winnerName}. Starting wins sequence.`);
                                soundDelayTimer = setTimeout(playWinsAndStartTimer, 300);
                            };
                            nameAudio.onerror = (e) => {
                                console.error(`[BattleScene] Error loading winner name audio:`, e);
                                playWinsAndStartTimer(); // Call directly on error
                            };
                            // Ensure audio actually tries to play
                            nameAudio.play().catch(error => {
                                console.error(`[BattleScene] Error playing winner name audio directly:`, error);
                                playWinsAndStartTimer(); // Call directly if play() fails
                            });
                        } catch (error) {
                            console.error(`[BattleScene] Error creating Audio object for winner name:`, error);
                            playWinsAndStartTimer(); // Call directly on error
                        }
                    } else {
                        console.log("[BattleScene GAME_OVER] winnerAudioUrl is null, calling playWinsAndStartTimer directly.");
                        playWinsAndStartTimer(); // Call directly if no winner audio URL
                    }
                 } else {
                    console.log('[BattleScene GAME_OVER] Skipped game over sequence because gameOverSequenceInitiatedRef was true.');
                 }
                break;
        }
    }, [fightPhase, player1NameAudioUrl, player2NameAudioUrl, versusSoundUrl, readySoundUrl, fightSoundUrl, onSceneVisible, winnerName, player1Name, player2Name, winsSoundUrl, isPaused]);

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
                // If a winner is determined while in FIGHT phase, set them and transition to GAME_OVER.
                setWinnerName(determinedWinner);
                setFightPhase('GAME_OVER');
            }
        }
        // Optional: Handle if fightPhase is already GAME_OVER but winnerName might need an update,
        // for instance, if winnerName was null when the phase transitioned.
        else if (fightPhase === 'GAME_OVER' && winnerName === null) {
            let potentialWinner: string | null = null;
            // Check health conditions to determine a winner if not already set
            if (player1Health <= 0 && player2Health > 0) {
                potentialWinner = player2Name;
            } else if (player2Health <= 0 && player1Health > 0) {
                potentialWinner = player1Name;
            } else if (player1Health <= 0 && player2Health <= 0) {
                // Both players at 0 health, and no winner recorded. This could be a draw.
                // Specific game logic for draws would be needed here. For now, log it.
                console.log("[BattleScene] GAME_OVER with null winnerName and both players at 0 health. Possible draw?");
            }

            if (potentialWinner) {
                console.log(`[BattleScene] Setting winner in GAME_OVER phase as name was null: ${potentialWinner}`);
                setWinnerName(potentialWinner);
            }
        }
    }, [player1Health, player2Health, fightPhase, player1Name, player2Name, winnerName]); // Removed isPaused from dependencies

    // --- Pause Menu Handlers ---
    const handleResume = () => {
        playSoundEffect('/sounds/effects/confirm.mp3');
        setIsPaused(false);
        setShowPauseMenu(false);
    };

    const handleRestart = () => {
        playSoundEffect('/sounds/effects/confirm.mp3');
        if (gameOverMenuTimerRef.current) {
            clearTimeout(gameOverMenuTimerRef.current);
            gameOverMenuTimerRef.current = null;
            console.log("[BattleScene handleRestart] Cleared pending GAME_OVER menu timer.");
        }
        setRestartCounter(prev => prev + 1);
        setIsPaused(false);
        setShowPauseMenu(false);
    };

    const handleBackToSelect = () => {
        playSoundEffect('/sounds/effects/confirm.mp3');
        fightStartTriggeredRef.current = false;
        router.push(`/vs/${player1Id}`);
    };

    return (
        <BattleStateContext.Provider value={battleStateValue}>
            <React.Fragment key={restartCounter}>
                <Canvas
                    shadows
                    camera={{ position: [CAM_X, CAM_Y, MIN_CAM_Z + 0.2], fov: INITIAL_FOV }}
                    style={{ height: '100%', width: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}
                >
                    <SceneContent
                        player1ModelUrl={player1ModelUrl}
                        player2ModelUrl={player2ModelUrl}
                        player1SpecialImageUrl={player1SpecialImageUrl}
                        player2SpecialImageUrl={player2SpecialImageUrl}
                        isAIActive={isAIEnabled && !isPaused}
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
                        isPaused={isPaused}
                        maxEnergy={MAX_ENERGY_BATTLESCENE}
                    />
                </Canvas>

                {/* UI Overlay */}
                 <div style={{
                     position: 'absolute', top: 0, left: 0, width: '100%',
                     padding: '20px', boxSizing: 'border-box', pointerEvents: 'none',
                     zIndex: 2, display: 'flex', justifyContent: 'space-between',
                     alignItems: 'flex-start'
                 }}>
                    <HealthBar name={player1Name} currentHealth={player1Health} maxHealth={MAX_HEALTH} alignment="left" style={{ position: 'relative' }} currentEnergy={player1Energy} maxEnergy={MAX_ENERGY_BATTLESCENE} />
                    <HealthBar name={player2Name} currentHealth={player2Health} maxHealth={MAX_HEALTH} alignment="right" style={{ position: 'relative' }} currentEnergy={player2Energy} maxEnergy={MAX_ENERGY_BATTLESCENE} />
                </div>

                 {/* --- Ready/Fight Text Overlay --- */}
                 <div style={{
                     position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                     zIndex: 3, pointerEvents: 'none', textAlign: 'center'
                 }}>
                     {showReadyText && !isPaused && <p style={{ fontSize: '4em', color: 'white', fontWeight: 'bold', textShadow: '2px 2px 4px #000000' }}>Ready?</p>}
                     {showFightText && !isPaused && <p style={{ fontSize: '5em', color: 'red', fontWeight: 'bold', textShadow: '3px 3px 6px #000000' }}>FIGHT!</p>}
                    {showWinnerBanner && winnerName && !isPaused && (
                        <p style={{
                            fontSize: '3.5em',
                            color: '#FFD700',
                            fontWeight: 'bold',
                            textShadow: '3px 3px 6px #000000',
                            whiteSpace: 'nowrap'
                        }}>
                            {winnerName}<br /> Wins!
                        </p>
                    )}
                 </div>

                 {/* --- Pause Menu Overlay --- */}
                 {showPauseMenu && (
                     <div style={{
                         position: 'absolute', inset: 0, zIndex: 10,
                         backgroundColor: 'rgba(0, 0, 0, 0.7)',
                         display: 'flex', flexDirection: 'column',
                         alignItems: 'center', justifyContent: 'center',
                         color: 'white', fontFamily: 'Arial, sans-serif',
                         pointerEvents: 'auto'
                     }}>
                         <h2 style={{ fontSize: '3em', marginBottom: '40px', textShadow: '2px 2px 4px #000' }}>
                             {fightPhase === 'GAME_OVER' ? 'Game Over' : 'Paused'}
                         </h2>
                         {fightPhase !== 'GAME_OVER' && (
                            <button onClick={handleResume} style={pauseButtonStyle}>Resume Fight</button>
                         )}
                         <button onClick={handleRestart} style={pauseButtonStyle}>Restart Fight</button>
                         <button onClick={handleBackToSelect} style={pauseButtonStyle}>Back to Fighter Selection</button>
                     </div>
                 )}

            </React.Fragment>
        </BattleStateContext.Provider>
    );
}

// Basic style for pause menu buttons
const pauseButtonStyle: React.CSSProperties = {
    background: 'rgba(50, 50, 50, 0.8)',
    border: '2px solid #FFD700',
    color: '#FFD700',
    padding: '15px 30px',
    margin: '10px',
    fontSize: '1.5em',
    cursor: 'pointer',
    borderRadius: '5px',
    minWidth: '300px',
    textAlign: 'center',
    transition: 'background-color 0.2s, color 0.2s',
}; 

// --- REMOVED: Redundant constant declaration (already passed as prop) ---
// const MAX_ENERGY_SCENECONTENT = 100; 
