'use strict';

TABS.script = {
    'validateText': "",
    'currentLine': "",
    'sequenceElements': 0,
    lineDelayMs: 15,
    profileSwitchDelayMs: 100
};

var templates = {};


TABS.script.initialize = function (callback) {
    var self = this;

    if (GUI.active_tab != 'script') {
        GUI.active_tab = 'script';
    }
    
    $('#content').load("./tabs/script.html", function () {
        // translate to user-selected language
        localize();

        CONFIGURATOR.scriptActive = true;

        var textarea = $('.tab-script textarea');

        $('a.macro').click(function () {

                var context = {pid: 20};
                var out_string = Handlebars.templates.version(context);
                self.history.add(out_string.trim());

                var outputArray = out_string.split("\n");
                Promise.reduce(outputArray, function(delay, line) {
                    return new Promise(function (resolve) {
                        GUI.timeout_add('CLI_send_slowly', function () {
                            var processingDelay = self.lineDelayMs;
                            if (line.toLowerCase().startsWith('profile')) {
                                processingDelay = self.profileSwitchDelayMs;
                            }

                            self.sendLine(line, function () {
                                resolve(processingDelay);
                            });
                        }, delay)
                    })
                }, 0);
            
        });

        textarea.keypress(function (event) {
            if (event.which == 13) { // enter
                event.preventDefault(); // prevent the adding of new line

                var out_string = textarea.val();
                self.history.add(out_string.trim());

                var outputArray = out_string.split("\n");
                Promise.reduce(outputArray, function(delay, line) {
                    return new Promise(function (resolve) {
                        GUI.timeout_add('CLI_send_slowly', function () {
                            var processingDelay = self.lineDelayMs;
                            if (line.toLowerCase().startsWith('profile')) {
                                processingDelay = self.profileSwitchDelayMs;
                            }

                            self.sendLine(line, function () {
                                resolve(processingDelay);
                            });
                        }, delay)
                    })
                }, 0);

                textarea.val('');
            }
        });

        textarea.keyup(function (event) {
            var keyUp = {38: true},
                keyDown = {40: true};

            if (event.keyCode in keyUp) {
                textarea.val(self.history.prev());
            }

            if (event.keyCode in keyDown) {
                textarea.val(self.history.next());
            }
        });

        // give input element user focus
        textarea.focus();

        GUI.timeout_add('enter_script', function enter_script() {
            // Enter CLI mode
            var bufferOut = new ArrayBuffer(1);
            var bufView = new Uint8Array(bufferOut);

            bufView[0] = 0x23; // #

            serial.send(bufferOut);
        }, 250);

        GUI.content_ready(callback);
    });
};

TABS.script.history = {
    history: [],
    index:  0
};

TABS.script.history.add = function (str) {
    this.history.push(str);
    this.index = this.history.length;
};
TABS.script.history.prev = function () {
    if (this.index > 0) this.index -= 1;
    return this.history[this.index];
};
TABS.script.history.next = function () {
    if (this.index < this.history.length) this.index += 1;
    return this.history[this.index - 1];
};

TABS.script.read = function (readInfo) {
    /*  Some info about handling line feeds and carriage return

        line feed = LF = \n = 0x0A = 10
        carriage return = CR = \r = 0x0D = 13

        MAC only understands CR
        Linux and Unix only understand LF
        Windows understands (both) CRLF
        Chrome OS currenty unknown
    */
    var data = new Uint8Array(readInfo.data),
        text = "";

    for (var i = 0; i < data.length; i++) {
        if (CONFIGURATOR.scriptValid) {
            if (data[i] == 27 || this.sequenceElements > 0) { // ESC + other
                this.sequenceElements++;

                // delete previous space
                if (this.sequenceElements == 1) {
                    text = text.substring(0, text.length -1);
                }

                // Reset
                if (this.sequenceElements >= 5) {
                    this.sequenceElements = 0;
                }
            }

            if (this.sequenceElements == 0) {
                switch (data[i]) {
                    case 10: // line feed
                        if (GUI.operating_system != "MacOS") {
                            text += "<br />";
                        }
                        this.currentLine = "";
                        break;
                    case 13: // carriage return
                        if (GUI.operating_system == "MacOS") {
                            text += "<br />";
                        }
                        this.currentLine = "";
                        break;
                    case 60:
                        text += '&lt';
                        break;
                    case 62:
                        text += '&gt';
                        break;

                    default:
                        text += String.fromCharCode(data[i]);
                        this.currentLine += String.fromCharCode(data[i]);
                }
            }
            if (this.currentLine == 'Rebooting') {
                CONFIGURATOR.scriptActive = false;
                CONFIGURATOR.scriptValid = false;
                GUI.log(chrome.i18n.getMessage('cliReboot'));
                GUI.log(chrome.i18n.getMessage('deviceRebooting'));

                if (BOARD.find_board_definition(CONFIG.boardIdentifier).vcp) { // VCP-based flight controls may crash old drivers, we catch and reconnect
                    $('a.connect').click();
                    GUI.timeout_add('start_connection',function start_connection() {
                        $('a.connect').click();
                    },2500);
                } else {

                    GUI.timeout_add('waiting_for_bootup', function waiting_for_bootup() {
                        MSP.send_message(MSPCodes.MSP_STATUS, false, false, function() {
                            GUI.log(chrome.i18n.getMessage('deviceReady'));
                            if (!GUI.tab_switch_in_progress) {
                                $('#tabs ul.mode-connected .tab_setup a').click();
                            }
                        });
                    },1500); // 1500 ms seems to be just the right amount of delay to prevent data request timeouts
                }
            }
        } else {
            // try to catch part of valid CLI enter message
            this.validateText += String.fromCharCode(data[i]);
            text += String.fromCharCode(data[i]);
        }
    }

    if (!CONFIGURATOR.scriptValid && this.validateText.indexOf('CLI') != -1) {
        GUI.log(chrome.i18n.getMessage('scriptEnter'));
        CONFIGURATOR.scriptValid = true;
        this.validateText = "";
    }

    $('.tab-script .window .wrapper').append(text);
    $('.tab-script .window').scrollTop($('.tab-script .window .wrapper').height());
};

TABS.script.sendLine = function (line, callback) {
    var bufferOut = new ArrayBuffer(line.length + 1);
    var bufView = new Uint8Array(bufferOut);

    for (var c_key = 0; c_key < line.length; c_key++) {
        bufView[c_key] = line.charCodeAt(c_key);
    }

    bufView[line.length] = 0x0D; // enter (\n)

    serial.send(bufferOut, callback);
}

TABS.script.cleanup = function (callback) {
    if (!CONFIGURATOR.connectionValid || !CONFIGURATOR.scriptValid) {
        if (callback) callback();
        return;
    }

    var bufferOut = new ArrayBuffer(5);
    var bufView = new Uint8Array(bufferOut);

    bufView[0] = 0x65; // e
    bufView[1] = 0x78; // x
    bufView[2] = 0x69; // i
    bufView[3] = 0x74; // t
    bufView[4] = 0x0D; // enter

    serial.send(bufferOut, function (writeInfo) {
        // we could handle this "nicely", but this will do for now
        // (another approach is however much more complicated):
        // we can setup an interval asking for data lets say every 200ms, when data arrives, callback will be triggered and tab switched
        // we could probably implement this someday
        GUI.timeout_add('waiting_for_bootup', function waiting_for_bootup() {
            if (callback) callback();
        }, 1000); // if we dont allow enough time to reboot, CRC of "first" command sent will fail, keep an eye for this one
        CONFIGURATOR.scriptActive = false;
    });
};
