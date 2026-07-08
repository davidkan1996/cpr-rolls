import { CPRRollsPanel } from "./cpr-rolls-panel.js";
import {
    showRollOverlay,
    showOutcomeOverlay,
    stopEpicHeartbeat,
    closeRollOverlay
} from "./popup-overlay.js";

Hooks.once("ready", () => {
    game.cprRolls = game.cprRolls || {};
    game.cprRolls.panel = null;

    game.socket.on("module.cpr-rolls", async data => {
        if (!data?.type) return;

        if (data.type === "rollRequest") {
            showRollOverlay(data.payload);
            return;
        }

        if (data.type === "rollResult") {
            Hooks.callAll("CPR_ROLLS_RESULT", data.payload);
            return;
        }

        if (data.type === "stopHeartbeat") {
            stopEpicHeartbeat();
            return;
        }

        if (data.type === "closeOverlay") {
            closeRollOverlay(data.payload);
            return;
        }

        if (data.type === "outcomeOverlay") {
            showOutcomeOverlay(data.payload);
            return;
        }
    });

    game.cprRollsOpen = () => {
        if (!game.cprRolls.panel) game.cprRolls.panel = new CPRRollsPanel();
        game.cprRolls.panel.render(true);
    };

    console.log("CPR Rolls by Sleepingman | Ready v4.2.0");
});

Hooks.on("getSceneControlButtons", controls => {
    if (!game.user.isGM) return;

    const tokenControls = controls.find(c => c.name === "token");
    if (!tokenControls) return;

    const exists = tokenControls.tools.some(t => t.name === "open-cpr-rolls");
    if (exists) return;

    tokenControls.tools.push({
        name: "open-cpr-rolls",
        title: "Open CPR Rolls",
        icon: "fas fa-satellite-dish",
        button: true,
        onClick: () => game.cprRollsOpen()
    });
});
