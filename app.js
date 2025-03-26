document.addEventListener('DOMContentLoaded', () => {
    // DOM要素の取得
    const micSelect = document.getElementById('mic-select');
    const startButton = document.getElementById('start-button');
    const stopButton = document.getElementById('stop-button');
    const micStatus = document.getElementById('mic-status');
    const volumeBar = document.getElementById('volume-bar');
    const volumeValue = document.getElementById('volume-value');
    const waveformCanvas = document.getElementById('waveform');
    const spectrumCanvas = document.getElementById('spectrum');

    // キャンバスのコンテキスト
    const waveformCtx = waveformCanvas.getContext('2d');
    const spectrumCtx = spectrumCanvas.getContext('2d');

    // Web Audio API関連の変数
    let audioContext;
    let analyser;
    let microphone;
    let javascriptNode;
    let mediaStream;

    // 描画用のデータ配列
    let dataArray;
    let bufferLength;

    // アニメーションフレーム
    let animationId;

    // デバイスリストの更新
    async function updateDeviceList() {
        try {
            // デバイスを列挙
            const devices = await navigator.mediaDevices.enumerateDevices();

            // マイクデバイスのみをフィルタリング
            const microphones = devices.filter(device => device.kind === 'audioinput');

            if (microphones.length === 0) {
                micStatus.textContent = 'マイク：デバイスが見つかりません';
                micStatus.className = 'mic-disconnected';
                return;
            }

            // 現在選択されているデバイスIDを保存
            const currentDeviceId = micSelect.value;

            // セレクトボックスにオプションを追加
            micSelect.innerHTML = '';

            // デフォルトデバイスのオプションを追加
            const defaultOption = document.createElement('option');
            defaultOption.value = 'default';
            defaultOption.text = 'デフォルトマイク';
            micSelect.appendChild(defaultOption);

            // 各マイクデバイスのオプションを追加（デフォルトデバイスを除外）
            microphones.forEach(mic => {
                // デフォルトデバイスはスキップ（既に追加済み）
                if (mic.deviceId === 'default' || mic.deviceId === '') {
                    return;
                }

                const option = document.createElement('option');
                option.value = mic.deviceId;

                // ラベルがない場合は代替テキストを使用
                if (mic.label) {
                    option.text = mic.label;
                } else {
                    option.text = `マイク ${micSelect.options.length}`;
                }

                micSelect.appendChild(option);
            });

            // 以前選択されていたデバイスを再選択
            if (currentDeviceId && Array.from(micSelect.options).some(option => option.value === currentDeviceId)) {
                micSelect.value = currentDeviceId;
            } else {
                micSelect.value = 'default';
            }

            micSelect.disabled = false;
            startButton.disabled = false;

            micStatus.textContent = `マイク：${microphones.length}台のデバイスが利用可能`;
            micStatus.className = 'mic-connected';

            // デバイス名のログ出力（デバッグ用）
            console.log('利用可能なマイクデバイス:');
            microphones.forEach(mic => {
                console.log(`- ${mic.label || 'ラベルなし'} (ID: ${mic.deviceId})`);
            });
        } catch (err) {
            console.error('デバイスの列挙中にエラーが発生しました:', err);
            micStatus.textContent = 'マイク：アクセスエラー';
            micStatus.className = 'mic-disconnected';
        }
    }

    // 初期化
    async function init() {
        // マイクデバイスの列挙と監視
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                // 一時的にマイクにアクセスしてデバイス情報を取得
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

                // 一時ストリームを停止
                stream.getTracks().forEach(track => track.stop());

                // デバイスリストを更新
                await updateDeviceList();

                // デバイス変更の監視
                navigator.mediaDevices.addEventListener('devicechange', async() => {
                    console.log('デバイスの変更を検出しました');
                    await updateDeviceList();
                });
            } catch (err) {
                console.error('マイクへのアクセス中にエラーが発生しました:', err);
                micStatus.textContent = 'マイク：アクセスが拒否されました';
                micStatus.className = 'mic-disconnected';
            }
        } else {
            micStatus.textContent = 'マイク：お使いのブラウザはデバイス列挙をサポートしていません';
            micStatus.className = 'mic-disconnected';
        }

        // キャンバスのサイズ設定
        resizeCanvases();
        window.addEventListener('resize', resizeCanvases);
    }

    // キャンバスのリサイズ
    function resizeCanvases() {
        waveformCanvas.width = waveformCanvas.offsetWidth;
        waveformCanvas.height = waveformCanvas.offsetHeight;
        spectrumCanvas.width = spectrumCanvas.offsetWidth;
        spectrumCanvas.height = spectrumCanvas.offsetHeight;
    }

    // マイクの開始
    async function startMicrophone() {
        if (mediaStream) {
            stopMicrophone();
        }

        try {
            // AudioContextの作成
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();

            // FFTサイズの設定（2の累乗である必要がある）
            analyser.fftSize = 2048;
            bufferLength = analyser.frequencyBinCount;
            dataArray = new Uint8Array(bufferLength);

            // マイクへのアクセス
            const constraints = {
                audio: {}
            };

            // デフォルト以外のデバイスが選択されている場合
            if (micSelect.value && micSelect.value !== 'default') {
                constraints.audio = {
                    deviceId: { exact: micSelect.value }
                };
            }

            console.log(`選択されたマイク: ${micSelect.options[micSelect.selectedIndex].text} (ID: ${micSelect.value})`);
            console.log('使用する制約:', JSON.stringify(constraints));

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            mediaStream = stream;

            // 実際に使用されているデバイスの情報を取得
            const tracks = stream.getAudioTracks();
            if (tracks.length > 0) {
                const settings = tracks[0].getSettings();
                console.log('使用中のマイク設定:', settings);

                // 使用中のデバイスIDを取得
                const currentDeviceId = settings.deviceId;

                // デバイスリストを更新して、現在使用中のデバイスを特定
                const devices = await navigator.mediaDevices.enumerateDevices();
                const currentDevice = devices.find(device =>
                    device.kind === 'audioinput' && device.deviceId === currentDeviceId
                );

                if (currentDevice) {
                    console.log(`実際に使用されているマイク: ${currentDevice.label} (ID: ${currentDevice.deviceId})`);
                }
            }

            // マイク入力をAudioContextに接続
            microphone = audioContext.createMediaStreamSource(stream);
            microphone.connect(analyser);

            // 音量検出用のScriptProcessorNode
            // 注意: ScriptProcessorNodeは非推奨ですが、互換性のために使用
            javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);
            analyser.connect(javascriptNode);
            javascriptNode.connect(audioContext.destination);

            // 音量検出
            javascriptNode.onaudioprocess = function() {
                analyser.getByteTimeDomainData(dataArray);

                // 音量の計算（RMS）
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    // 0-255の値を-1.0〜1.0に変換
                    const amplitude = ((dataArray[i] / 128.0) - 1.0);
                    sum += amplitude * amplitude;
                }

                const rms = Math.sqrt(sum / bufferLength);

                // デシベル値に変換（-60dB〜0dB）
                let db = 20 * Math.log10(rms);
                if (db < -60) db = -60;
                if (db > 0) db = 0;

                // 音量メーターの更新
                const volumePercent = 100 + (db * 5 / 3); // -60dBで0%、0dBで100%
                volumeBar.style.width = `${volumePercent}%`;
                volumeValue.textContent = `${Math.round(db)} dB`;
            };

            // UI更新
            startButton.disabled = true;
            stopButton.disabled = false;
            micSelect.disabled = true;

            const selectedMic = micSelect.options[micSelect.selectedIndex].text;
            micStatus.textContent = `マイク：${selectedMic} 接続中`;
            micStatus.className = 'mic-connected';

            // 描画開始
            draw();
        } catch (err) {
            console.error('マイクへのアクセス中にエラーが発生しました:', err);
            console.error(err);
            micStatus.textContent = `マイク：アクセスエラー (${err.name}: ${err.message})`;
            micStatus.className = 'mic-disconnected';

            // AudioContextをクリーンアップ
            if (audioContext) {
                await audioContext.close();
                audioContext = null;
            }
        }
    }

    // マイクの停止
    function stopMicrophone() {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }

        if (javascriptNode) {
            javascriptNode.disconnect();
            javascriptNode = null;
        }

        if (microphone) {
            microphone.disconnect();
            microphone = null;
        }

        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }

        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close().then(() => {
                audioContext = null;
            });
        }

        // UI更新
        startButton.disabled = false;
        stopButton.disabled = true;
        micSelect.disabled = false;

        micStatus.textContent = 'マイク：停止中';
        volumeBar.style.width = '0%';
        volumeValue.textContent = '0 dB';

        // キャンバスのクリア
        clearCanvases();
    }

    // キャンバスのクリア
    function clearCanvases() {
        waveformCtx.fillStyle = '#2c3e50';
        waveformCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);

        spectrumCtx.fillStyle = '#2c3e50';
        spectrumCtx.fillRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
    }

    // 波形とスペクトラムの描画
    function draw() {
        animationId = requestAnimationFrame(draw);

        // 波形データの取得
        analyser.getByteTimeDomainData(dataArray);

        // 波形キャンバスのクリア
        waveformCtx.fillStyle = '#2c3e50';
        waveformCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);

        // 波形の描画
        waveformCtx.lineWidth = 2;
        waveformCtx.strokeStyle = '#3498db';
        waveformCtx.beginPath();

        const sliceWidth = waveformCanvas.width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = v * waveformCanvas.height / 2;

            if (i === 0) {
                waveformCtx.moveTo(x, y);
            } else {
                waveformCtx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        waveformCtx.lineTo(waveformCanvas.width, waveformCanvas.height / 2);
        waveformCtx.stroke();

        // スペクトラムデータの取得
        analyser.getByteFrequencyData(dataArray);

        // スペクトラムキャンバスのクリア
        spectrumCtx.fillStyle = '#2c3e50';
        spectrumCtx.fillRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);

        // スペクトラムの描画
        const barWidth = (spectrumCanvas.width / bufferLength) * 2.5;
        let barHeight;
        x = 0;

        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 255 * spectrumCanvas.height;

            // グラデーションの作成
            const gradient = spectrumCtx.createLinearGradient(0, spectrumCanvas.height, 0, 0);
            gradient.addColorStop(0, '#3498db');
            gradient.addColorStop(0.5, '#2ecc71');
            gradient.addColorStop(1, '#e74c3c');

            spectrumCtx.fillStyle = gradient;
            spectrumCtx.fillRect(x, spectrumCanvas.height - barHeight, barWidth, barHeight);

            x += barWidth + 1;
            if (x > spectrumCanvas.width) break;
        }
    }

    // イベントリスナー
    startButton.addEventListener('click', startMicrophone);
    stopButton.addEventListener('click', stopMicrophone);

    // 初期化
    init();
});
