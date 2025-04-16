import React, { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PlayerCharacterHandle, InputState } from './PlayerCharacter'; // Import InputState type

// --- Types ---

// Mirroring the pressedKeys state from PlayerCharacter for AI control
type AIInputState = {
    left: boolean;
    right: boolean;
    punch: boolean;
    duck: boolean;
    block: boolean;
    jump: boolean;
};

interface AIControllerProps {
    playerRef: React.RefObject<PlayerCharacterHandle | null>; // Allow null initially
    opponentRef: React.RefObject<PlayerCharacterHandle | null>; // Allow null initially
    isActive?: boolean; // To easily enable/disable AI
    aiInputRef: React.MutableRefObject<InputState>; // Add the ref to update
}

// --- Constants ---
const AI_DECISION_INTERVAL = 0.5; // Seconds between major decisions
const AI_REACTION_TIME = 0.1; // Base reaction time (can add randomness)
const ENGAGE_DISTANCE = 1.5; // Distance at which AI tries to engage/fight
const CLOSE_DISTANCE = 0.5; // Very close distance, might back off or block
const ATTACK_PROBABILITY = 0.6; // Probability of attacking when in range
const BLOCK_PROBABILITY = 0.3; // Probability of blocking when opponent attacks (if not attacking)


// --- Component ---
export const AIController: React.FC<AIControllerProps> = ({
    playerRef,
    opponentRef,
    isActive = true, // Default to active
    aiInputRef // Get the ref to update
}) => {
    // No need for internal state, update the passed ref directly
    // const aiInputRef = useRef<AIInputState>({...}); 
    const decisionTimer = useRef(0);

    // --- AI Control via PlayerCharacter Input Simulation ---
    // This effect simulates the keydown/keyup events based on aiInputRef changes
    // We might need a more direct way later, but this reuses existing logic
    useEffect(() => {
        if (!isActive || !playerRef.current) return;

        // TODO: Find a way to pass this simulated input state to the PlayerCharacter instance
        // Option 1: Modify PlayerCharacter to accept an optional 'externalInputState' prop.
        // Option 2: Expose methods on PlayerCharacterHandle like `pressKey('left')`, `releaseKey('right')`. (More complex)
        // Option 3: Refactor PlayerCharacter's input handling to be more modular.

        // For now, this effect doesn't directly *do* anything to the character,
        // the logic in useFrame will update aiInputRef.

    }, [isActive, playerRef, aiInputRef.current]); // Dependency needed?


    // --- AI Logic Loop ---
    useFrame((state, delta) => {
        if (!isActive || !playerRef.current || !opponentRef.current) {
            // Reset inputs if AI becomes inactive
            if (aiInputRef.current.left || aiInputRef.current.right || aiInputRef.current.punch || aiInputRef.current.block) {
                 aiInputRef.current = { left: false, right: false, punch: false, duck: false, block: false, jump: false };
                 // TODO: Ensure PlayerCharacter reflects this reset
            }
            return;
        }

        const player = playerRef.current;
        const opponent = opponentRef.current;

        const playerGroup = player.getMainGroup();
        const opponentGroup = opponent.getMainGroup();

        if (!playerGroup || !opponentGroup) return;

        // --- State Gathering ---
        const playerPos = playerGroup.position;
        const opponentPos = opponentGroup.position;
        const distanceX = Math.abs(playerPos.x - opponentPos.x);
        const opponentIsAttacking = opponent.isAttacking();
        const opponentIsBlocking = opponent.isBlocking(); // Less useful for basic AI, but good to have
        const playerIsAttacking = player.isAttacking();
        const playerIsBlocking = player.isBlocking();
        const playerIsGrounded = player.getHasHitGround(); // Essential for movement/jumping decisions


        // --- Decision Making ---
        decisionTimer.current += delta;
        if (decisionTimer.current >= AI_DECISION_INTERVAL) {
            decisionTimer.current = 0; // Reset timer
            const currentInput = { ...aiInputRef.current }; // Copy current state

             // Reset momentary actions like punch
             currentInput.punch = false; 
             // Keep block/duck based on decision below

            // 1. Movement Logic (only if grounded and not attacking/blocking)
            if (playerIsGrounded && !playerIsAttacking && !playerIsBlocking) {
                if (distanceX > ENGAGE_DISTANCE) {
                    // Move towards opponent
                    if (playerPos.x < opponentPos.x) {
                        currentInput.left = false;
                        currentInput.right = true;
                    } else {
                        currentInput.left = true;
                        currentInput.right = false;
                    }
                } else if (distanceX < CLOSE_DISTANCE) {
                    // Too close, back off slightly? Or stand ground.
                    // For now, stop moving. Could add backing off later.
                    currentInput.left = false;
                    currentInput.right = false;
                } else {
                    // In engage range, stop moving horizontally to fight
                    currentInput.left = false;
                    currentInput.right = false;
                }
            } else if (!playerIsGrounded) {
                 // Stop horizontal movement input if airborne
                 currentInput.left = false;
                 currentInput.right = false;
            }


            // 2. Action Logic (Attack/Block) - (only if grounded and not already doing something)
             if (playerIsGrounded && !playerIsAttacking && !playerIsBlocking) {
                currentInput.block = false; // Default to not blocking unless decided below

                if (distanceX < ENGAGE_DISTANCE) {
                    // Opponent is attacking, decide to block?
                    if (opponentIsAttacking && Math.random() < BLOCK_PROBABILITY) {
                         console.log("[AI] Deciding to Block!");
                         currentInput.block = true;
                         currentInput.punch = false; // Can't attack and block
                         currentInput.left = false;  // Stop moving when blocking
                         currentInput.right = false;
                    } 
                    // Opponent not attacking, decide to attack?
                    else if (!opponentIsAttacking && Math.random() < ATTACK_PROBABILITY) {
                         console.log("[AI] Deciding to Punch!");
                         currentInput.punch = true; // Trigger punch (momentary)
                         currentInput.block = false;
                         // Optional: stop moving briefly when punching?
                         // currentInput.left = false;
                         // currentInput.right = false;
                    }
                }
            }

            // Apply the decided inputs
            aiInputRef.current = currentInput;
             // TODO: Make PlayerCharacter react to aiInputRef changes
        } else {
             // Reset punch immediately after one frame (if it was set)
             // This simulates a quick key press
             if(aiInputRef.current.punch) {
                 aiInputRef.current.punch = false;
                 // TODO: Make PlayerCharacter react
             }
        }

    });

    // This component doesn't render anything itself
    return null;
};
