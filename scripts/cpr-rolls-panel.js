const DV_TABLE = [
    ["Simple", 9],
    ["Everyday", 13],
    ["Difficult", 15],
    ["Professional", 17],
    ["Heroic", 21],
    ["Incredible", 24],
    ["Legendary", 29]
];

const QUICK_SKILLS = ["athletics", "evasion", "perception", "persuasion", "stealth"];

const SOUND_PATHS = {
    success: "modules/cpr-rolls/assets/sounds/success.ogg",
    failure: "modules/cpr-rolls/assets/sounds/failure.ogg"
};

function playSound(src, volume = 0.65) {
    try {
        const audio = new Audio(src);
        audio.volume = volume;
        audio.play().catch(() => {});
    } catch (err) {
        console.warn("CPR Rolls | Sound failed", err);
    }
}

function formatSkill(key) {
    return key.replace(/([A-Z])/g, " $1").replace(/And/g, "&").replace(/^./, c => c.toUpperCase());
}

function getPlayerCharacters() {
    return game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
}

function getSkillKeys() {
    const keys = new Set();
    for (const actor of getPlayerCharacters()) {
        const skills = actor.system.skills ?? {};
        for (const key of Object.keys(skills)) keys.add(key);
    }
    return [...keys].sort((a, b) => formatSkill(a).localeCompare(formatSkill(b)));
}

function getOwningUser(actor) {
    const activeOwner = game.users.find(u => !u.isGM && u.active && actor.testUserPermission(u, "OWNER"));
    if (activeOwner) return activeOwner;
    return game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
}

function groupByUser(actors) {
    const grouped = new Map();

    for (const actor of actors) {
        const user = getOwningUser(actor);
        if (!user) {
            ui.notifications.warn(`No owning user found for ${actor.name}.`);
            continue;
        }

        if (!grouped.has(user.id)) {
            grouped.set(user.id, {
                user,
                actors: []
            });
        }

        grouped.get(user.id).actors.push(actor);
    }

    return grouped;
}

export class CPRRollsPanel extends Application {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "cpr-rolls-panel",
            title: "CPR Rolls",
            width: 560,
            height: "auto",
            resizable: true,
            popOut: true,
            classes: ["cpr-rolls-window"]
        });
    }

    constructor(...args) {
        super(...args);
        this.activeRequestId = null;
        this.results = {};
        this.targets = [];
        this.currentSkill = "stealth";
        this.currentSkillLabel = "Stealth";
        this.currentDv = 17;
        this.currentEpic = false;
        this.currentGroup = true;
        this.autoResolved = false;

        Hooks.on("CPR_ROLLS_RESULT", payload => {
            if (!this.activeRequestId) return;
            if (payload.requestId !== this.activeRequestId) return;

            this.results[payload.actorId] = payload;
            this.render(false);

            const allRolled = Object.keys(this.results).length >= this.targets.length;

            if (allRolled) {
                if (this.currentEpic && this.currentGroup) {
                    game.socket.emit("module.cpr-rolls", { type: "stopHeartbeat", payload: { requestId: this.activeRequestId } });
                    game.socket.emit("module.cpr-rolls", {
                        type: "closeOverlay",
                        payload: {
                            requestId: this.activeRequestId,
                            message: "ALL ROLLS RECEIVED",
                            delay: 900
                        }
                    });
                }

                if (this.currentGroup && !this.autoResolved) {
                    this.autoResolved = true;
                    setTimeout(() => this.resolveGroup(true), 300);
                }
            }
        });
    }

    async _renderInner(data) {
        return $(this._buildHtml());
    }

    _buildHtml() {
        const actors = getPlayerCharacters();
        const skills = getSkillKeys();

        if (!actors.length) {
            return `<div class="cpr-rolls-panel"><div class="cpr-rolls-panel-title">CPR ROLLS</div><p>No player-owned character actors found.</p></div>`;
        }

        const defaultSkill = skills.includes(this.currentSkill)
            ? this.currentSkill
            : skills.includes("stealth") ? "stealth" : skills[0];

        const quickButtons = QUICK_SKILLS
            .filter(k => skills.includes(k))
            .map(k => `<button type="button" class="cpr-rolls-quick" data-skill="${k}">${formatSkill(k)}</button>`)
            .join("");

        const resultsRows = this.targets.length
            ? this.targets.map(t => {
                const r = this.results[t.id];
                return `<tr><td>${t.name}</td><td>${r ? r.total : "Waiting"}</td><td>${r ? r.result : "—"}</td></tr>`;
            }).join("")
            : `<tr><td colspan="3">No active request.</td></tr>`;

        return `
            <div class="cpr-rolls-panel">
                <div class="cpr-rolls-panel-title">CPR ROLLS</div>
                <div class="cpr-rolls-quick-row">${quickButtons}</div>

                <label>Skill</label>
                <select id="cpr-rolls-skill">
                    ${skills.map(k => `<option value="${k}" ${k === defaultSkill ? "selected" : ""}>${formatSkill(k)}</option>`).join("")}
                </select>

                <label>DV</label>
                <select id="cpr-rolls-dv">
                    ${DV_TABLE.map(([label, value]) => `<option value="${value}" ${value === this.currentDv ? "selected" : ""}>${label} (${value})</option>`).join("")}
                </select>

                <div class="cpr-rolls-mode-box">
                    <label class="cpr-rolls-check"><input type="checkbox" id="cpr-rolls-group" checked> Group Roll</label>
                    <label class="cpr-rolls-check cpr-rolls-epic-check"><input type="checkbox" id="cpr-rolls-epic"> Epic</label>
                </div>

                <hr>

                <div class="cpr-rolls-player-grid">
                    ${actors.map(a => `
                        <label class="cpr-rolls-player-card">
                            <input type="checkbox" class="cpr-rolls-player" value="${a.id}">
                            <img src="${a.prototypeToken?.texture?.src ?? a.img ?? "icons/svg/mystery-man.svg"}">
                            <span>${a.name}</span>
                        </label>
                    `).join("")}
                </div>

                <div class="cpr-rolls-button-row">
                    <button type="button" id="cpr-rolls-select-all">Select All</button>
                    <button type="button" id="cpr-rolls-send">Send Request</button>
                    <button type="button" id="cpr-rolls-resolve">Resolve Group</button>
                </div>

                <hr>

                <div class="cpr-rolls-results-title">LIVE RESULTS</div>
                <table class="cpr-rolls-results">
                    <thead><tr><th>Runner</th><th>Roll</th><th>Status</th></tr></thead>
                    <tbody>${resultsRows}</tbody>
                </table>

                <div class="cpr-rolls-sound-note">
                    Group rolls auto-resolve after all selected characters roll.
                </div>
            </div>
        `;
    }

    activateListeners(html) {
        super.activateListeners(html);
        const root = html[0];

        root.querySelectorAll(".cpr-rolls-quick").forEach(button => {
            button.addEventListener("click", () => {
                const select = root.querySelector("#cpr-rolls-skill");
                if (select) select.value = button.dataset.skill;
            });
        });

        root.querySelector("#cpr-rolls-select-all")?.addEventListener("click", () => {
            const boxes = [...root.querySelectorAll(".cpr-rolls-player")];
            const allChecked = boxes.every(b => b.checked);
            boxes.forEach(b => b.checked = !allChecked);
        });

        root.querySelector("#cpr-rolls-send")?.addEventListener("click", () => this.sendRequest(root));
        root.querySelector("#cpr-rolls-resolve")?.addEventListener("click", () => this.resolveGroup(false));
    }

    sendRequest(root) {
        const skill = root.querySelector("#cpr-rolls-skill")?.value;
        const dv = Number(root.querySelector("#cpr-rolls-dv")?.value ?? 17);
        const group = root.querySelector("#cpr-rolls-group")?.checked ?? true;
        const epic = root.querySelector("#cpr-rolls-epic")?.checked ?? false;

        const selected = [...root.querySelectorAll(".cpr-rolls-player:checked")]
            .map(i => game.actors.get(i.value))
            .filter(Boolean);

        if (!selected.length) {
            ui.notifications.warn("Select at least one character.");
            return;
        }

        const requestId = foundry.utils.randomID();

        this.activeRequestId = requestId;
        this.results = {};
        this.targets = selected.map(a => ({ id: a.id, name: a.name }));
        this.currentSkill = skill;
        this.currentSkillLabel = formatSkill(skill);
        this.currentDv = dv;
        this.currentEpic = epic;
        this.currentGroup = group;
        this.autoResolved = false;

        if (epic) {
            game.socket.emit("module.cpr-rolls", {
                type: "rollRequest",
                payload: {
                    requestId,
                    audienceOnly: true,
                    actorId: null,
                    userId: null,
                    skill,
                    skillLabel: formatSkill(skill),
                    dv,
                    group,
                    epic,
                    canRoll: false
                }
            });
        }

        const grouped = groupByUser(selected);

        for (const [userId, entry] of grouped) {
            const actors = entry.actors;

            if (actors.length > 1) {
                game.socket.emit("module.cpr-rolls", {
                    type: "rollRequest",
                    payload: {
                        requestId,
                        audienceOnly: false,
                        multiActors: true,
                        userId,
                        actors: actors.map(a => ({ actorId: a.id, actorName: a.name })),
                        skill,
                        skillLabel: formatSkill(skill),
                        dv,
                        group,
                        epic,
                        canRoll: true
                    }
                });
            } else {
                const actor = actors[0];

                game.socket.emit("module.cpr-rolls", {
                    type: "rollRequest",
                    payload: {
                        requestId,
                        audienceOnly: false,
                        multiActors: false,
                        actorId: actor.id,
                        userId,
                        skill,
                        skillLabel: formatSkill(skill),
                        dv,
                        group,
                        epic,
                        canRoll: true
                    }
                });
            }
        }

        ui.notifications.info(epic ? "Epic CPR Roll request sent." : "CPR Roll request sent.");
        this.render(false);
    }

    resolveGroup(auto = false) {
        if (!this.activeRequestId) {
            ui.notifications.warn("No active request.");
            return;
        }

        const results = Object.values(this.results);
        if (!results.length) {
            ui.notifications.warn("No rolls recorded yet.");
            return;
        }

        const avg = results.reduce((sum, r) => sum + r.total, 0) / results.length;
        const success = avg >= this.currentDv;
        const cls = success ? "success" : "failure";

        if (this.currentEpic) {
            game.socket.emit("module.cpr-rolls", { type: "stopHeartbeat", payload: { requestId: this.activeRequestId } });
            game.socket.emit("module.cpr-rolls", { type: "closeOverlay", payload: { requestId: this.activeRequestId } });

            playSound(success ? SOUND_PATHS.success : SOUND_PATHS.failure);

            game.socket.emit("module.cpr-rolls", {
                type: "outcomeOverlay",
                payload: {
                    success,
                    epic: true,
                    detail: `Average ${avg.toFixed(2)} vs DV ${this.currentDv}`
                }
            });
        }

        const breakdown = results.map(r => `
            <div>
                ${r.actorName}: ${r.total} (${r.result})
                ${r.formula ? `<br><span class="cpr-rolls-breakdown">${r.formula}</span>` : ""}
            </div>
        `).join("");

        ChatMessage.create({
            speaker: { alias: "CPR ROLLS" },
            content: `
                <div class="cpr-rolls-group-card cpr-rolls-group-${cls}">
                    <div class="cpr-rolls-chat-kicker">${this.currentEpic ? "CRUCIAL ROLE REPORT" : "CPR ROLLS REPORT"}</div>
                    <h2>${success ? "GROUP SUCCESS" : "GROUP FAILURE"}</h2>
                    <div><b>${this.currentSkillLabel}</b></div>
                    <div>Average: ${avg.toFixed(2)}</div>
                    <div>DV: ${this.currentDv}</div>
                    <div>${auto ? "Auto-resolved after all rolls received." : "Resolved by GM."}</div>
                    <hr>
                    ${breakdown}
                </div>
            `
        });
    }
}
