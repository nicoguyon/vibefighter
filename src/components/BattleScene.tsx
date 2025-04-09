import React, { Suspense, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
// Import from @react-three/cannon
import * as THREE from 'three';
import { OrbitControls } from '@react-three/drei';
// Uncomment PlayerCharacter
import { PlayerCharacter } from './PlayerCharacter'; 

interface BattleSceneProps {
    playerModelUrl: string;
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

export function BattleScene({ playerModelUrl }: BattleSceneProps) {
    return (
        <Canvas 
            camera={{ position: [0, 1.5, 8], fov: 50 }}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        >
            {/* Basic Scene Setup */} 
            <color attach="background" args={['#add8e6']} />
            <ambientLight intensity={0.5} />
            <directionalLight 
                position={[5, 10, 5]} 
                intensity={1} 
                // shadows disabled
            />

            {/* Comment out Physics provider AGAIN */}
            {/* <Physics 
                gravity={[0, -9.81, 0]}
                stepSize={1 / 30}
                maxSubSteps={3}
                iterations={3}
            >
                <GroundPlane />
                <PlayerCharacter modelUrl={playerModelUrl} /> 
            </Physics> */}

            {/* Render ground visually */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[50, 50]} />
                <meshStandardMaterial color="lightgrey" />
            </mesh>
            
            {/* Render player visually without physics */}
            <Suspense fallback={null}>
                 <PlayerCharacter modelUrl={playerModelUrl} /> 
            </Suspense>

            {/* Controls */}
            <OrbitControls /> 
        </Canvas>
    );
} 