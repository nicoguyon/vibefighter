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
    currentHealth: number; // Add currentHealth prop
}

// --- Constants ---
const AI_DECISION_INTERVAL = 0.3;
const AI_REACTION_TIME = 0.1;
const ENGAGE_DISTANCE = 1.5;
const CLOSE_DISTANCE = 0.5;
const PUNCH_DISTANCE = 0.8;
const OPTIMAL_DISTANCE = 0.7; // New: Ideal distance to maintain
const ATTACK_PROBABILITY = 0.8; // Increased from 0.6
const BLOCK_PROBABILITY = 0.3;
const SPECIAL_ATTACK_PROBABILITY = 0.4;
const MIN_ENERGY_FOR_SPECIAL = 50;
const JUMP_PROBABILITY = 0.3;
const BACK_OFF_PROBABILITY = 0.4;
const CIRCLE_PROBABILITY = 0.2;
const PREDICTIVE_BLOCK_PROBABILITY = 0.4;
const MIN_HEALTH_FOR_CAUTION = 300;
const MAX_HEALTH = 1000;
const MOVEMENT_COOLDOWN = 0.5; // New: Cooldown between movement decisions
const ATTACK_COOLDOWN = 0.3; // New: Cooldown between attacks


// --- Component ---
export const AIController: React.FC<AIControllerProps> = ({
    playerRef,
    opponentRef,
    isActive = true, // Default to active
    aiInputRef, // Get the ref to update
    isPaused, // <-- Destructure isPaused
    currentHealth, // Add currentHealth to props
}) => {
    // No need for internal state, update the passed ref directly
    // const aiInputRef = useRef<AIInputState>({...}); 
    const decisionTimer = useRef(0);
    const lastMovementTimeRef = useRef(0);
    const lastAttackTimeRef = useRef(0);

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

        // --- Enhanced State Gathering ---
        const playerPos = playerGroup.position;
        const opponentPos = opponentGroup.position;
        const distanceX = Math.abs(playerPos.x - opponentPos.x);
        const directionToOpponent = Math.sign(opponentPos.x - playerPos.x);
        const opponentIsAttacking = opponent.isAttacking();
        const opponentIsBlocking = opponent.isBlocking();
        const playerIsAttacking = player.isAttacking();
        const playerIsBlocking = player.isBlocking();
        const playerIsGrounded = player.getHasHitGround();
        const playerEnergy = player.getCurrentEnergy();
        const playerHealth = currentHealth; // Use the prop directly

        // --- Decision Making ---
        decisionTimer.current += delta;
        if (decisionTimer.current >= AI_DECISION_INTERVAL) {
            decisionTimer.current = 0;
            
            const pcIsAttacking = player.isAttacking();
            const pcIsBlocking = player.isBlocking();

            const newAIInput: InputState = {
                left: false,
                right: false,
                punch: false,
                duck: false,
                block: false,
                jump: false,
                special: false
            };

            // --- 1. ENHANCED MOVEMENT DECISION LOGIC ---
            if (playerIsGrounded && !pcIsAttacking) {
                const isLowHealth = playerHealth < MIN_HEALTH_FOR_CAUTION;
                const shouldBeCautious = isLowHealth || opponentIsAttacking;

                // Add movement cooldown check
                const now = performance.now();
                const timeSinceLastMove = now - (lastMovementTimeRef.current || 0);
                const canMove = timeSinceLastMove > MOVEMENT_COOLDOWN * 1000;

                if (shouldBeCautious) {
                    // Defensive movement when low health or opponent is attacking
                    if (distanceX < CLOSE_DISTANCE && canMove) {
                        // Back off if too close
                        newAIInput.left = directionToOpponent < 0;
                        newAIInput.right = directionToOpponent > 0;
                        lastMovementTimeRef.current = now;
                    } else if (Math.random() < CIRCLE_PROBABILITY && canMove) {
                        // Sometimes circle the opponent
                        newAIInput.left = directionToOpponent > 0;
                        newAIInput.right = directionToOpponent < 0;
                        lastMovementTimeRef.current = now;
                    }
                } else {
                    // Normal movement patterns
                    if (distanceX > PUNCH_DISTANCE && canMove) {
                        // Move towards opponent until in punch range
                        newAIInput.right = directionToOpponent > 0;
                        newAIInput.left = directionToOpponent < 0;
                        lastMovementTimeRef.current = now;
                    } else if (distanceX < CLOSE_DISTANCE && canMove) {
                        // Back off or circle when too close
                        if (Math.random() < BACK_OFF_PROBABILITY) {
                            newAIInput.left = directionToOpponent < 0;
                            newAIInput.right = directionToOpponent > 0;
                            lastMovementTimeRef.current = now;
                        } else if (Math.random() < CIRCLE_PROBABILITY) {
                            newAIInput.left = directionToOpponent > 0;
                            newAIInput.right = directionToOpponent < 0;
                            lastMovementTimeRef.current = now;
                        }
                    } else if (distanceX < OPTIMAL_DISTANCE && canMove) {
                        // If too close to optimal distance, back off slightly
                        newAIInput.left = directionToOpponent < 0;
                        newAIInput.right = directionToOpponent > 0;
                        lastMovementTimeRef.current = now;
                    }
                }

                // Add jumping behavior
                if (Math.random() < JUMP_PROBABILITY && !pcIsAttacking && canMove) {
                    if (shouldBeCautious) {
                        // Defensive jump when opponent is attacking
                        if (opponentIsAttacking && distanceX < ENGAGE_DISTANCE) {
                            newAIInput.jump = true;
                            lastMovementTimeRef.current = now;
                        }
                    } else {
                        // Offensive jump to close distance
                        if (distanceX > CLOSE_DISTANCE && distanceX < ENGAGE_DISTANCE) {
                            newAIInput.jump = true;
                            lastMovementTimeRef.current = now;
                        }
                    }
                }
            }

            // --- 2. ENHANCED ACTION DECISION LOGIC ---
            if (playerIsGrounded && !pcIsAttacking) {
                const isLowHealth = playerHealth < MIN_HEALTH_FOR_CAUTION;
                const shouldBeCautious = isLowHealth || opponentIsAttacking;

                // Add attack cooldown check
                const now = performance.now();
                const timeSinceLastAttack = now - (lastAttackTimeRef.current || 0);
                const canAttack = timeSinceLastAttack > ATTACK_COOLDOWN * 1000;

                // A. Enhanced Blocking Logic
                if (opponentIsAttacking && Math.random() < BLOCK_PROBABILITY) {
                    console.log("[AI] Decision: BLOCK (Reactive)");
                    newAIInput.block = true;
                    newAIInput.punch = false;
                    newAIInput.special = false;
                    newAIInput.left = false;
                    newAIInput.right = false;
                } else if (!opponentIsAttacking && Math.random() < PREDICTIVE_BLOCK_PROBABILITY) {
                    // Sometimes block preemptively
                    console.log("[AI] Decision: BLOCK (Predictive)");
                    newAIInput.block = true;
                }

                // B. Enhanced Attack Logic
                if (!newAIInput.block && !opponentIsAttacking && canAttack) {
                    // Only attack when in proper range
                    if (distanceX <= PUNCH_DISTANCE) {
                        if (shouldBeCautious) {
                            // More conservative when low health, but still attack
                            if (Math.random() < ATTACK_PROBABILITY * 0.7) { // Increased from 0.5
                                console.log("[AI] Decision: PUNCH (Cautious)");
                                newAIInput.punch = true;
                                newAIInput.left = false;
                                newAIInput.right = false;
                                lastAttackTimeRef.current = now;
                            }
                        } else {
                            // Normal attack patterns - more aggressive
                            if (playerEnergy >= MIN_ENERGY_FOR_SPECIAL && Math.random() < SPECIAL_ATTACK_PROBABILITY) {
                                console.log("[AI] Decision: SPECIAL ATTACK");
                                newAIInput.special = true;
                                newAIInput.left = false;
                                newAIInput.right = false;
                                lastAttackTimeRef.current = now;
                            } else if (Math.random() < ATTACK_PROBABILITY) {
                                console.log("[AI] Decision: PUNCH");
                                newAIInput.punch = true;
                                newAIInput.left = false;
                                newAIInput.right = false;
                                lastAttackTimeRef.current = now;
                            }
                        }
                    } else {
                        // If not in range, focus on movement
                        console.log("[AI] Too far to attack, focusing on movement");
                    }
                }
            }
            
            // Update the ref with the newly decided input state
            aiInputRef.current = newAIInput;

        } else {
            // Reset momentary actions
            if (aiInputRef.current.punch) {
                aiInputRef.current.punch = false;
            }
            if (aiInputRef.current.special) {
                aiInputRef.current.special = false;
            }
            if (aiInputRef.current.jump) {
                aiInputRef.current.jump = false;
            }
        }
    });

    // This component doesn't render anything itself
    return null;
};
