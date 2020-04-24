// tkokada
var EthernetAddr = require("./ethernet_addr");

var DeviceInfo = function(raw_packet, offset) {
  if (!(this instanceof DeviceInfo)) {
    return new DeviceInfo(raw_packet, offset);
  }
  this.device_info_id = raw_packet.readUInt8(offset);
  this.device_info_len = raw_packet.readUInt8(offset + 1);
  this.payload = null;
  switch (this.device_info_id) {
  case 0x01: // Device category
  case 0x02: // Manufacturer code
  case 0x03: // Model name
  case 0x04: // Model number
  case 0x14: // Channel Usage Information
  case 0x15: // Radio Signal Strength Information
  case 0x16: // Communication Error rate Information
  case 0x17: // Response Time
  case 0x18: // Number of Associated devices
  case 0x19: // Number of active nodes
  case 0x1A: // Link Quality
  case 0x1B: // Number of retransmission
  case 0x32: // Status Information
  case 0x33: // CPU Usage Rate
  case 0x34: // Memory Usage rate
  case 0x35: // HDD usage rate
  case 0x36: // Remaining Battery Level
  case 0x50: // LLDPDU Transmission Interval
    this.payload = raw_packet.toString("ascii", offset + 2, offset + 2 + this.device_info_len);
    break;
  default:
    break;
  }
};

DeviceInfo.prototype.toString = function () {
    return "device info id: " + this.device_info_id + ", len: " + this.device_info_len + ", payload: " + this.payload;
};

var LinkInfo = function(raw_packet, offset) {
  if (!(this instanceof LinkInfo)) {
    return new LinkInfo(raw_packet, offset);
  }
  this.iftype_len = raw_packet.readUInt8(offset);
  this.iftype = raw_packet.readUInt8(offset + 1);
  this.portno_len = raw_packet.readUInt8(offset + 1 + this.iftype_len);
  this.portno = raw_packet.readUInt8(offset + 2 + this.iftype_len);
  this.macaddr_num = raw_packet.readUInt8(offset + 2 + this.iftype_len + this.portno_len);
  this.payload = [];
  for (var i = 0; i < this.macaddr_num; i++) {
    var macaddr = new EthernetAddr(raw_packet, offset + 3 + this.iftype_len + this.portno_len + 6 * i);
    this.payload.push(macaddr.toString());
  }
};

LinkInfo.prototype.toString = function () {
    return "iftype: " + this.iftype + ", portno: " + this.portno + ", macnum: " + this.macaddr_num + ", FDB: " + this.payload;
};

var MacList = function(raw_packet, offset) {
  if (!(this instanceof MacList)) {
    return new MacList(raw_packet, offset);
  }
  this.macaddr_num = raw_packet.readUInt8(offset);
  this.payload = [];
  var _offset = offset + 1;
  for (var i = 0; i < this.macaddr_num; i++) {
    var macaddr_len = raw_packet.readUInt8(_offset);
    var macaddr = new EthernetAddr(raw_packet, _offset + 1);
    _offset += 1 + macaddr_len;
    this.payload.push(macaddr.toString());
    console.log("macaddr: " + macaddr + ", num: " + this.macaddr_num + ", len: " + macaddr_len);
  }
};

MacList.prototype.toString = function () {
    return "MAC num: " + this.macaddr_num + ", MAC len: " + this.macaddr_len + ", MAC list: " + this.payload;
};

var HtipTlv = function(raw_packet, offset, len) {
  if (!(this instanceof HtipTlv)) {
      return new HtipTlv(raw_packet, offset, len);
  }
  /* jshint ignore:start */
  this.ttc_oui = new Uint8Array(3);
  /* jshint ignore:end */
  this.ttc_oui[0] = raw_packet.readUInt8(offset);
  this.ttc_oui[1] = raw_packet.readUInt8(offset + 1);
  this.ttc_oui[2] = raw_packet.readUInt8(offset + 2);
  this.ttc_subtype = raw_packet.readUInt8(offset + 3);
  this.payload = null;
  switch (this.ttc_subtype) {
  case 0x01: // Device info
      this.payload = new DeviceInfo(raw_packet, offset + 4);
      break;
  case 0x02: // Link info
      this.payload = new LinkInfo(raw_packet, offset + 4);
      break;
  case 0x03: // MAC address list
      this.payload = new MacList(raw_packet, offset + 4);
      break;
  default:
  }
};

HtipTlv.prototype.toString = function () {
    return "TTC OUI: " + this.ttc_oui[0].toString(16) + "-" + this.ttc_oui[1].toString(16) + "-" + this.ttc_oui[2].toString(16) + ", TTC subtype: " + this.ttc_subtype + ", payload: " + this.payload;
};

module.exports = HtipTlv;
