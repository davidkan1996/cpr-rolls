const SOUND_PATHS = {
    heartbeat: "modules/cpr-rolls/assets/sounds/heartbeat.ogg",
    success: "modules/cpr-rolls/assets/sounds/success.ogg",
    failure: "modules/cpr-rolls/assets/sounds/failure.ogg"
};

let heartbeatAudio = null;

function playSound(src, loop = false, volume = 0.55) {
    try {
        const audio = new Audio(src);
        audio.loop = loop;
        audio.volume = volume;
        audio.play().catch(() => {});
        return audio;
    } catch (err) {
        console.warn("CPR Rolls | Sound failed", err);
        return null;
    }
}


async function showDiceSoNiceRoll(roll) {
    try {
        const diceSoNiceActive =
            game.modules.get("dice-so-nice")?.active &&
            game.dice3d &&
            typeof game.dice3d.showForRoll === "function";

        if (!diceSoNiceActive) return;

        await game.dice3d.showForRoll(
            roll,
            game.user,
            true,
            null,
            false
        );
    } catch (err) {
        console.warn("CPR Rolls | Dice So Nice animation failed", err);
    }
}

async function rollVisibleD10() {
    const roll = await new Roll("1d10").evaluate();
    await showDiceSoNiceRoll(roll);

    return {
        roll,
        value: roll.total
    };
}

function d10() {
    return Math.floor(Math.random() * 10) + 1;
}

async function rollCyberpunkCheck(base) {
    const firstRoll = await rollVisibleD10();
    const first = firstRoll.value;

    let second = null;
    let total = base + first;
    let mode = "normal";

    if (first === 10) {
        const secondRoll = await rollVisibleD10();
        second = secondRoll.value;
        total = base + first + second;
        mode = "critical-success";
    } else if (first === 1) {
        const secondRoll = await rollVisibleD10();
        second = secondRoll.value;
        total = base + first - second;
        mode = "critical-failure";
    }

    let formula = `1d10(${first}) + Base ${base}`;
    if (mode === "critical-success") formula = `1d10(${first}) + Bonus d10(${second}) + Base ${base}`;
    if (mode === "critical-failure") formula = `1d10(${first}) - Penalty d10(${second}) + Base ${base}`;

    return { first, second, base, total, mode, formula };
}

export function stopEpicHeartbeat() {
    if (heartbeatAudio) {
        heartbeatAudio.pause();
        heartbeatAudio.currentTime = 0;
        heartbeatAudio = null;
    }
}

export function closeRollOverlay(data = {}) {
    if (data.requestId) {
        const overlay = document.getElementById("cpr-rolls-overlay");
        if (overlay && overlay.dataset.requestId && overlay.dataset.requestId !== data.requestId) return;
    }

    stopEpicHeartbeat();

    const overlay = document.getElementById("cpr-rolls-overlay");
    if (!overlay) return;

    if (data.message) {
        const box = overlay.querySelector(".cpr-rolls-container");
        if (box) {
            box.innerHTML = `
                <div class="cpr-rolls-kicker">TRANSMISSION CLOSED</div>
                <h1>${data.message}</h1>
            `;
        }

        setTimeout(() => {
            overlay.classList.add("cpr-rolls-fade-out");
            setTimeout(() => overlay.remove(), 350);
        }, data.delay ?? 900);
        return;
    }

    overlay.classList.add("cpr-rolls-fade-out");
    setTimeout(() => overlay.remove(), 350);
}

export function showOutcomeOverlay(data) {
    const existing = document.getElementById("cpr-rolls-outcome-overlay");
    if (existing) existing.remove();

    const success = data.success;
    const overlay = document.createElement("div");
    overlay.id = "cpr-rolls-outcome-overlay";
    overlay.classList.add(success ? "cpr-rolls-outcome-success" : "cpr-rolls-outcome-failure");

    overlay.innerHTML = `
        <div class="cpr-rolls-outcome-box">
            <div class="cpr-rolls-kicker">${data.epic ? "CRUCIAL ROLE" : "CPR ROLLS REPORT"}</div>
            <h1>${success ? "SUCCESS" : "FAILURE"}</h1>
            <div class="cpr-rolls-outcome-detail">${data.detail ?? ""}</div>
        </div>
    `;

    document.body.appendChild(overlay);

    setTimeout(() => {
        overlay.classList.add("cpr-rolls-fade-out");
        setTimeout(() => overlay.remove(), 450);
    }, 2200);
}

function actorCard(actorPayload, data, index) {
    const actor = game.actors.get(actorPayload.actorId);
    if (!actor) return "";

    const img = actor.prototypeToken?.texture?.src ?? actor.img ?? "icons/svg/mystery-man.svg";
    const canRoll = actor.isOwner && actor.system.skills?.[data.skill];

    return `
        <div class="cpr-rolls-multi-card" data-actor-id="${actor.id}">
            <img src="${img}" class="cpr-rolls-multi-portrait">
            <div class="cpr-rolls-multi-name">${actor.name}</div>
            ${canRoll ? `<button class="cpr-rolls-character-roll" data-actor-id="${actor.id}" data-index="${index}">ROLL</button>` : `<div class="cpr-rolls-standby">NO ACCESS</div>`}
            <div class="cpr-rolls-character-status" data-status-for="${actor.id}">WAITING</div>
        </div>
    `;
}

async function rollForActor(actor, data, button = null, statusEl = null) {
    const skillData = actor.system.skills?.[data.skill];
    if (!skillData) {
        ui.notifications.warn(`Skill not found: ${data.skillLabel}`);
        return;
    }

    if (button) button.disabled = true;

    const base = (skillData.level ?? 0) + (skillData.stat ?? 0) + (skillData.mods ?? 0);
    const check = await rollCyberpunkCheck(base);
    const total = check.total;

    let result = "FAILURE";
    if (total >= data.dv) result = "SUCCESS";
    else if (total >= data.dv - 4) result = "PARTIAL";

    const passed = total >= data.dv;
    const resultClass = result.toLowerCase();

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `
            <div class="cpr-rolls-chat-card cpr-rolls-chat-${resultClass}">
                <div class="cpr-rolls-chat-kicker">${data.epic ? "CRUCIAL ROLE RESULT" : "CPR ROLLS RESULT"}</div>
                <h2>${result}</h2>
                <div><b>${data.skillLabel}</b></div>
                <div>${actor.name}</div>
                <div>${check.formula}</div>
                <div><b>Total:</b> ${total} vs DV ${data.dv}</div>
                ${check.mode === "critical-success" ? `<div class="cpr-rolls-crit-good">Natural 10: bonus d10 added</div>` : ""}
                ${check.mode === "critical-failure" ? `<div class="cpr-rolls-crit-bad">Natural 1: penalty d10 subtracted</div>` : ""}
            </div>
        `
    });

    if (statusEl) {
        statusEl.innerHTML = `${total} // ${result}`;
        statusEl.classList.add(`cpr-rolls-status-${resultClass}`);
    }

    game.socket.emit("module.cpr-rolls", {
        type: "rollResult",
        payload: {
            requestId: data.requestId,
            actorId: actor.id,
            actorName: actor.name,
            total,
            result,
            passed,
            epic: data.epic,
            group: data.group,
            userId: game.user.id,
            formula: check.formula,
            first: check.first,
            second: check.second,
            base: check.base,
            mode: check.mode
        }
    });

    return { total, result, passed, formula: check.formula };
}

export async function showRollOverlay(data) {
    /*
      Modes:
      - audienceOnly: everyone sees/hears standby popup, no roll button.
      - multiActors: one user owns multiple requested characters; show a larger popup with one button per character.
      - single actor: original single-character popup stays intact.
    */
    if (data.audienceOnly) {
        if (!data.epic) return;
    } else {
        if (data.userId && game.user.id !== data.userId) return;
    }

    const existing = document.getElementById("cpr-rolls-overlay");
    if (existing) existing.remove();

    if (data.epic) {
        stopEpicHeartbeat();
        heartbeatAudio = playSound(SOUND_PATHS.heartbeat, true, 0.45);
    }

    const overlay = document.createElement("div");
    overlay.id = "cpr-rolls-overlay";
    overlay.dataset.requestId = data.requestId ?? "";
    if (data.epic) overlay.classList.add("cpr-rolls-epic-mode");

    if (data.audienceOnly) {
        overlay.innerHTML = `
            <div class="cpr-rolls-overlay-shell">
                <div class="cpr-rolls-scanline"></div>
                <div class="cpr-rolls-container">
                    <h1>${data.epic ? "CRUCIAL ROLE" : "ROLL REQUEST"}</h1>
                    <img src="icons/svg/mystery-man.svg" class="cpr-rolls-portrait">
                    <div class="cpr-rolls-actor">STANDBY</div>
                    <div class="cpr-rolls-skill">${data.skillLabel}</div>
                    <div class="cpr-rolls-dv">DV ${data.dv}</div>
                    <div class="cpr-rolls-standby">WAITING FOR SELECTED RUNNERS</div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        return;
    }

    if (data.multiActors && Array.isArray(data.actors) && data.actors.length > 1) {
        overlay.classList.add("cpr-rolls-multi-overlay");

        overlay.innerHTML = `
            <div class="cpr-rolls-overlay-shell">
                <div class="cpr-rolls-scanline"></div>
                <div class="cpr-rolls-container cpr-rolls-container-wide">
                    <h1>${data.epic ? "CRUCIAL ROLE" : "ROLL REQUEST"}</h1>
                    <div class="cpr-rolls-skill">${data.skillLabel}</div>
                    <div class="cpr-rolls-dv">DV ${data.dv}</div>
                    <div class="cpr-rolls-multi-grid">
                        ${data.actors.map((a, i) => actorCard(a, data, i)).join("")}
                    </div>
                    <div class="cpr-rolls-rule-note">Roll each requested character.</div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const rolledActors = new Set();

        overlay.querySelectorAll(".cpr-rolls-character-roll").forEach(button => {
            button.addEventListener("click", async () => {
                const actorId = button.dataset.actorId;
                if (rolledActors.has(actorId)) return;

                const actor = game.actors.get(actorId);
                if (!actor) return;

                const statusEl = overlay.querySelector(`[data-status-for="${actorId}"]`);
                rolledActors.add(actorId);

                await rollForActor(actor, data, button, statusEl);

                if (rolledActors.size >= data.actors.length) {
                    const box = overlay.querySelector(".cpr-rolls-container");
                    const footer = document.createElement("div");
                    footer.className = "cpr-rolls-rule-note";
                    footer.innerHTML = "ALL CHARACTER ROLLS SENT";
                    box.appendChild(footer);

                    setTimeout(() => {
                        overlay.classList.add("cpr-rolls-fade-out");
                        setTimeout(() => overlay.remove(), 350);
                    }, 1500);
                }
            });
        });

        return;
    }

    const actor = data.actorId ? game.actors.get(data.actorId) : null;
    if (!actor) return;

    const skillData = actor.system.skills?.[data.skill];
    const canRoll = Boolean(data.canRoll && actor.isOwner && skillData);
    if (data.canRoll && !canRoll && !data.epic) return;

    const img = actor.prototypeToken?.texture?.src ?? actor.img ?? "icons/svg/mystery-man.svg";

    overlay.innerHTML = `
        <div class="cpr-rolls-overlay-shell">
            <div class="cpr-rolls-scanline"></div>
            <div class="cpr-rolls-container">
                <h1>${data.epic ? "CRUCIAL ROLE" : "ROLL REQUEST"}</h1>
                <img src="${img}" class="cpr-rolls-portrait">
                <div class="cpr-rolls-actor">${canRoll ? actor.name : "STANDBY"}</div>
                <div class="cpr-rolls-skill">${data.skillLabel}</div>
                <div class="cpr-rolls-dv">DV ${data.dv}</div>
                ${canRoll ? `<button id="cpr-rolls-roll" class="cpr-rolls-main-button">ROLL</button>` : `<div class="cpr-rolls-standby">WAITING FOR SELECTED RUNNERS</div>`}
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    if (!canRoll) return;

    let rolled = false;

    overlay.querySelector("#cpr-rolls-roll").addEventListener("click", async () => {
        if (rolled) return;
        rolled = true;

        const rollResult = await rollForActor(actor, data);

        if (data.epic && !data.group) {
            closeRollOverlay({
                requestId: data.requestId,
                message: "ROLL COMPLETE",
                delay: 900
            });

            game.socket.emit("module.cpr-rolls", {
                type: "stopHeartbeat",
                payload: { requestId: data.requestId }
            });

            game.socket.emit("module.cpr-rolls", {
                type: "closeOverlay",
                payload: {
                    requestId: data.requestId,
                    message: "ROLL COMPLETE",
                    delay: 900
                }
            });

            playSound(rollResult.passed ? SOUND_PATHS.success : SOUND_PATHS.failure, false, 0.65);

            showOutcomeOverlay({
                success: rollResult.passed,
                epic: true,
                detail: `${actor.name}: ${rollResult.total} vs DV ${data.dv}`
            });

            game.socket.emit("module.cpr-rolls", {
                type: "outcomeOverlay",
                payload: {
                    success: rollResult.passed,
                    epic: true,
                    detail: `${actor.name}: ${rollResult.total} vs DV ${data.dv}`
                }
            });
        } else {
            overlay.querySelector(".cpr-rolls-container").innerHTML = `
                <div class="cpr-rolls-kicker">TRANSMISSION SENT</div>
                <h1>ROLL ACCEPTED</h1>
                <div class="cpr-rolls-dv">${rollResult.total} // ${rollResult.result}</div>
                <div class="cpr-rolls-rule-note">${rollResult.formula}</div>
            `;

            setTimeout(() => {
                overlay.classList.add("cpr-rolls-fade-out");
                setTimeout(() => overlay.remove(), 350);
            }, 1500);
        }
    });
}
