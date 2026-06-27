(function () {
    if (!window.Spectral) {
        return;
    }

    async function plantuml(filename) {
        try {
            const sourceInfo = await resolvePlantUmlSource(filename);
            if (!sourceInfo) {
                Spectral.setStatus('PlantUML render cancelled.');
                return null;
            }

            Spectral.setStatus('Rendering PlantUML SVG...');
            const svg = await Spectral.renderPlantUmlSvg(sourceInfo);
            Spectral.insertSvgCode(currentInsertIndex(), svg);
            Spectral.setStatus('Inserted PlantUML SVG.');
            return svg;
        } catch (error) {
            Spectral.setStatus(`PlantUML error: ${error.message}`);
            throw error;
        }
    }

    async function resolvePlantUmlSource(filename) {
        const trimmedFilename = String(filename || '').trim();
        if (trimmedFilename) {
            return { filename: trimmedFilename };
        }

        const selected = Spectral.getEditorSelectionText && Spectral.getEditorSelectionText();
        if (selected && selected.trim()) {
            return { source: selected };
        }

        const entered = await Spectral.processTextInput(
            'PlantUML',
            'PlantUML spec',
            null,
            '@startuml\nAlice -> Bob: hello\n@enduml'
        );
        if (!entered || !String(entered).trim()) {
            return null;
        }
        return { source: entered };
    }

    function currentInsertIndex() {
        if (typeof Spectral.getCurrentIndex !== 'function') {
            return 'end';
        }
        return Spectral.getCurrentIndex() || 'end';
    }

    Spectral.registerCommand('plantuml', plantuml);
    window.plantuml = plantuml;
})();
