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
    special: boolean; // <-- ADDED: Special attack
};

interface AIControllerProps {
    playerRef: React.RefObject<PlayerCharacterHandle | null>; // Allow null initially
    opponentRef: React.RefObject<PlayerCharacterHandle | null>; // Allow null initially
    isActive?: boolean; // To easily enable/disable AI
    aiInputRef: React.MutableRefObject<InputState>; // Add the ref to update
    isPaused: boolean; // <-- Add isPaused prop
}

// --- Constants ---
const AI_DECISION_INTERVAL = 0.5; // Seconds between major decisions
const AI_REACTION_TIME = 0.1; // Base reaction time (can add randomness)
const ENGAGE_DISTANCE = 1.5; // Distance at which AI tries to engage/fight
const CLOSE_DISTANCE = 0.5; // Very close distance, might back off or block
const ATTACK_PROBABILITY = 0.6; // Probability of attacking when in range
const BLOCK_PROBABILITY = 0.3; // Probability of blocking when opponent attacks (if not attacking)
const SPECIAL_ATTACK_PROBABILITY = 0.4; // <-- ADDED: Probability of using special attack
const MIN_ENERGY_FOR_SPECIAL = 50; // <-- ADDED: Minimum energy for AI to consider special


// --- Component ---
export const AIController: React.FC<AIControllerProps> = ({
    playerRef,
    opponentRef,
    isActive = true, // Default to active
    aiInputRef, // Get the ref to update
    isPaused, // <-- Destructure isPaused
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
        // <-- PAUSE CHECK: Stop AI logic if paused or inactive -->
        if (!isActive || isPaused) {
            // Reset AI input when paused or inactive
            if (aiInputRef.current.left || aiInputRef.current.right || aiInputRef.current.punch || aiInputRef.current.block || aiInputRef.current.special) { // <-- ADDED: Check special
                 aiInputRef.current = { left: false, right: false, punch: false, duck: false, block: false, jump: false, special: false }; // <-- ADDED: Reset special
                 // TODO: Ensure PlayerCharacter reflects this reset
            }
            return;
        }

        if (!isActive || !playerRef.current || !opponentRef.current) {
            // Reset inputs if AI becomes inactive
            if (aiInputRef.current.left || aiInputRef.current.right || aiInputRef.current.punch || aiInputRef.current.block || aiInputRef.current.special) { // <-- ADDED: Check special
                 aiInputRef.current = { left: false, right: false, punch: false, duck: false, block: false, jump: false, special: false }; // <-- ADDED: Reset special
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
        const playerEnergy = player.getCurrentEnergy(); // <-- ADDED: Get AI's current energy


        // --- Decision Making ---
        decisionTimer.current += delta;
        if (decisionTimer.current >= AI_DECISION_INTERVAL) {
            decisionTimer.current = 0; // Reset timer
            
            // What the PlayerCharacter IS currently doing (based on its internal state refs)
            const pcIsAttacking = player.isAttacking();
            const pcIsBlocking = player.isBlocking();

            // Start with a new input state for this decision cycle
            // Momentary actions (punch, special, jump) default to false.
            // Block defaults to false and is actively decided.
            // Movement (left, right) can be initiated here or preserved if AI is in a continuous move.
            // Duck is not used by AI yet.
            const newAIInput: InputState = {
                left: false, // Will be decided by movement logic
                right: false, // Will be decided by movement logic
                punch: false,
                duck: false, 
                block: false, // Default to NOT blocking this cycle
                jump: false, 
                special: false
            };

            // --- 1. MOVEMENT DECISION LOGIC ---
            // AI decides to move only if grounded and NOT currently in an attack animation from PlayerCharacter.
            // This movement can be overridden if an action (like block/punch/special) is taken.
            if (playerIsGrounded && !pcIsAttacking) {
                if (distanceX > ENGAGE_DISTANCE) {
                    // Move towards opponent
                    if (playerPos.x < opponentPos.x) {
                        newAIInput.right = true;
                    } else {
                        newAIInput.left = true;
                    }
                } else if (distanceX < CLOSE_DISTANCE) {
                    // Too close, stand still (could add back-off later)
                    // newAIInput.left/right remain false
                } else {
                    // In engage range, stand still to prepare for actions
                    // newAIInput.left/right remain false
                }
            } 
            // No else if (!playerIsGrounded) here, as left/right are already false by default.
            // If airborne, no new movement commands are issued.

            // --- 2. ACTION DECISION LOGIC (Block, Special, Punch) ---
            // Decisions are made if grounded and not already in a PC-driven attack animation.
            if (playerIsGrounded && !pcIsAttacking) {
                // A. Decide to BLOCK if opponent is attacking
                if (opponentIsAttacking && Math.random() < BLOCK_PROBABILITY) {
                     console.log("[AI] Decision: BLOCK");
                     newAIInput.block = true;
                     // If blocking, explicitly stop other actions and movement for this cycle.
                     newAIInput.punch = false;
                     newAIInput.special = false;
                     newAIInput.left = false; 
                     newAIInput.right = false;
                }
                // B. If NOT blocking (i.e., block condition above was false or random check failed),
                //    then consider Special or Punch if opponent is NOT attacking.
                else if (!newAIInput.block && !opponentIsAttacking && distanceX < ENGAGE_DISTANCE) { 
                    if (playerEnergy >= MIN_ENERGY_FOR_SPECIAL && Math.random() < SPECIAL_ATTACK_PROBABILITY) {
                        console.log("[AI] Decision: SPECIAL ATTACK");
                        newAIInput.special = true;
                        newAIInput.left = false; // Stop movement to perform special
                        newAIInput.right = false;
                    }
                    else if (Math.random() < ATTACK_PROBABILITY) {
                         console.log("[AI] Decision: PUNCH");
                         newAIInput.punch = true;
                         newAIInput.left = false; // Stop movement to perform punch
                         newAIInput.right = false;
                    }
                }
            }
            
            // Update the ref with the newly decided input state.
            aiInputRef.current = newAIInput;

        } else {
             // Reset momentary actions (punch, special) immediately after one frame if they were set.
             // Block and movement (left/right) are persistent until the next AI_DECISION_INTERVAL.
             if(aiInputRef.current.punch) {
                 aiInputRef.current.punch = false;
             }
             if(aiInputRef.current.special) {
                aiInputRef.current.special = false;
            }
        }
    });

    // This component doesn't render anything itself
    return null;
};
