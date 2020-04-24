// tkokada

var pcap = require("../pcap");
var network = require("network");
var arp = require("../arptable");
var upnp = require("node-upnp-utils");
var xml2js = require("xml2js");
var request = require("request");

var HtipNodeList = require("./htip_nodelist");
var kafka = require("kafka-node");
var Client = kafka.KafkaClient;
var Producer = kafka.Producer;
// Global variables
/* globals node_list: true */
node_list = new HtipNodeList();
/* globals ifnames: true */
ifnames = null;
/* globals manager_ip: true */
manager_ip = null;
/* globals manager_mac: true */
manager_mac = null;
/* globals manager_ip_mac: true */
manager_ip_mac = [];
/* globals manager_fdb: true */
manager_fdb = [];

var DEFAULT_TTL = 60 * 60 * 24; // 24h
//var DEFAULT_TTL = 120;
var producer = null;
var publisherReady = false;
var kafkaHost;
var topic;


function initKafkaProducer(){
  var client = new Client({ kafkaHost: kafkaHost });
  producer = new Producer(client);

  producer.on('ready', function () {
      console.log("Kafka Producer is ready!");
      publisherReady = true;
  });
  producer.on('error', function (err) {
    console.log('error', err);
  });
}
function publishHtipInfor(node){
  if(publisherReady) {
    let payloads = [
      {
        topic: topic,
        messages: JSON.stringify(node)
      }
    ];
    let push_status = producer.send(payloads, (err, data) => {
      if (err) {
        console.log('[kafka-producer ->  broker update failed');
      } else {
        console.log('[kafka-producer ->  Time: ' + node.timeStamp + 'IP: ' + node.ip + " MAC: " + node.mac + "TYPE: " + node.type);
      }
    });
  } else {
    console.log("Can not send message to kafka broker! KafkaProducer Error");
  }
}
// Get IP addresses and MAC addresses of this host
function get_manager_ip_mac() {
  var netifs = null;
  network.get_interfaces_list(function(err, obj) {
    netifs = obj;
  });
  setTimeout(function() {
    if (netifs !== null) {
      for (var i = 0; i < netifs.length; i++) {
        if (netifs[i].mac_address !== null) {
          manager_ip_mac.push(netifs[i]);
        }
        if (manager_ip === null && netifs[i].ip_address !== null) {
          manager_ip = netifs[i].ip_address;
        }
        if (manager_mac === null && netifs[i].mac_address !== null) {
          manager_mac = netifs[i].mac_address;
        }
      }
    }
  }, 500);
}

var HtipReceiver = function(ifname) {
if(process.argv.length <= 2) {
  console.log("Input kafka host address and topology to continue!");
  process.exit(-1);
}
kafkaHost=  process.argv[2];
topic =  process.argv[3];
  if (!(this instanceof HtipReceiver)) {
    return new HtipReceiver();
  }
  initKafkaProducer();
  if (typeof(ifname) !== 'undefined' && ifname !== null) {
    ifnames = [ifname];
  } else {
    ifnames = pcap.findalldevs().filter(function (dev) {
      return dev.addresses.length > 0 && dev.name !== "lo0";
    });
    ifnames = ifnames.map(function (dev) {
      return dev.name;
    });
  }
  ifnames.forEach(function(dev) {
    var filter = "ether proto 0x88cc";
    try {
      var session = pcap.createSession(dev, { filter: filter });

      session.on("packet", function(raw_packet) {
        var i, ip, mac, maclist = [], htip_type, chassis_id, port_id, ttl, port_desc, device_cat,
          manufacturer_code, model_name, model_number, channel_usage_infor, radio_signal_strength_infor,
          communication_error_rate_infor, response_time, number_of_associated_devices, number_of_active_nodes,
          link_quality, number_of_retransmission, status_information, cpu_usage_rate, memory_usage_rate,
          hdd_usage_rate, remaining_battery_level, lldpdu_transmission_interval;
        var l2agent = false, l3agent = false, nw = false, manager = false;
        var fdb = [];
        var packet = pcap.decode.packet(raw_packet);
        var etherPacket = packet.payload;
        mac = etherPacket.shost.toString();
        var lldp = etherPacket.payload;
        console.log("  BEGIN");
        for (i = 0; i < lldp.tlvs.length; i++) {
          switch (lldp.tlvs[i].tlv_type) {
          case 0x00: // End of LLDPDU
            break;
          case 0x01: // Chassis ID
            chassis_id = lldp.tlvs[i].payload.chassisid;
            console.log("  chassis_id: " + chassis_id);
            break;
          case 0x02: // Port ID
            port_id = lldp.tlvs[i].payload.portid;
            break;
          case 0x03: // TTL
            ttl = lldp.tlvs[i].payload.ttl;
            break;
          case 0x04: // Port description
            port_desc = lldp.tlvs[i].payload.portdesc;
            break;
          case 0x7f: // Organazation specific
            // HTIP TTC OUI 0xE0-27-1A
            if ((lldp.tlvs[i].payload.ttc_oui[0] !== 224) || (lldp.tlvs[i].payload.ttc_oui[1] !== 39) || (lldp.tlvs[i].payload.ttc_oui[2] !== 26)) {
              break;
            }
            switch (lldp.tlvs[i].payload.ttc_subtype) {
            case 0x01: // Device info
                l2agent = true;
                switch (lldp.tlvs[i].payload.payload.device_info_id) {
                case 0x01:
                  device_cat = lldp.tlvs[i].payload.payload.payload;
                  break;
                case 0x02:
                  manufacturer_code = lldp.tlvs[i].payload.payload.payload;
                  break;
                case 0x03:
                  model_name = lldp.tlvs[i].payload.payload.payload;
                  break;
                case 0x04:
                  model_number = lldp.tlvs[i].payload.payload.payload;
                  break;
                case 0x14:
                  channel_usage_infor = lldp.tlvs[i].payload.payload.payload;
                  break;
                case 0x15:
                  radio_signal_strength_infor = lldp.tlvs[i].payload.payload.payload;
                  break;
                case 0x16:
                  communication_error_rate_infor = lldp.tlvs[i].payload.payload.payload;
                  break;
                case 0x17:
                  response_time = lldp.tlvs[i].payload.payload.payload;
                  break;
                case 0x18:
                  number_of_associated_devices = lldp.tlvs[i].payload.payload.payload;
                  break;
                case 0x19:
                  number_of_active_nodes = lldp.tlvs[i].payload.payload.payload;
                  break;
                case 0x1A:
                  link_quality = lldp.tlvs[i].payload.payload.payload;
                  break;
                case 0x1B:
                  number_of_retransmission = lldp.tlvs[i].payload.payload.payload;
                  break;
                case 0x32:
                  status_information = lldp.tlvs[i].payload.payload.payload;
                  break;
                case 0x33:
                  cpu_usage_rate = lldp.tlvs[i].payload.payload.payload;
                  break;
                case 0x34:
                  memory_usage_rate = lldp.tlvs[i].payload.payload.payload;
                  break;
                case 0x35:
                  hdd_usage_rate = lldp.tlvs[i].payload.payload.payload;
                  break;   
                case 0x36:
                  remaining_battery_level = lldp.tlvs[i].payload.payload.payload;
                  break;     
                case 0x50:
                  lldpdu_transmission_interval = lldp.tlvs[i].payload.payload.payload;
                  break;     
                case 0xff:
                  console.log("Vendor Specific Property: " + lldp.tlvs[i].payload.payload.payload);   
                  break;     
                default:
                  console.log("Unknown HTIP device info TTC subtype: " + lldp.tlvs[i].payload.payload.device_info_id);
                  break;
                }
              break;
            case 0x02: // Link info
              nw = true;
              var portno = lldp.tlvs[i].payload.payload.portno;
              var fdb_maclist = lldp.tlvs[i].payload.payload.payload;
              fdb.push({port: portno, mac: fdb_maclist});
              console.log("  fdb: " + fdb_maclist);
              break;
            case 0x03: // MAC list
              maclist = lldp.tlvs[i].payload.payload.payload;
              console.log("  maclist: " + maclist);
              break;
            default:
              break;
            }
            break;
          default:
            break;
          }
        }
        console.log("  END");
        if (nw) {
          htip_type = "HTIP_NW";
        } else if (l2agent) {
          htip_type = "HTIP_L2_Agent";
        } else if (l3agent) {
          htip_type = "HTIP_L3_Agent";
        } else if (manager) {
          htip_type = "HTIP_Manager";
        }
        var date = new Date();
        if (ttl !== null) {
          date.setSeconds(date.getSeconds() + ttl);
        } else {
          date.setSeconds(date.getSeconds() + DEFAULT_TTL);
        }
        date.setSeconds(date.getSeconds() + DEFAULT_TTL); // workaround for SMK GW

        if (chassis_id != null) {
          mac = chassis_id;
        }
        var node_to_send = {timeStamp: new Date(),ip: ip, mac: mac, maclist: maclist, type: htip_type, chassis_id: chassis_id, port_id: port_id,
          ttl: ttl, port_desc: port_desc, device_category: device_cat, manufacturer_code: manufacturer_code, 
          model_name: model_name, model_number: model_number, channel_usage_infor: channel_usage_infor,
          radio_signal_strength_infor: radio_signal_strength_infor, communication_error_rate_infor:communication_error_rate_infor,
          response_time: response_time, number_of_associated_devices: number_of_associated_devices, 
          number_of_active_nodes: number_of_active_nodes, link_quality:link_quality, number_of_retransmission:number_of_retransmission, 
          status_information:status_information, cpu_usage_rate:cpu_usage_rate, memory_usage_rate:memory_usage_rate,
          hdd_usage_rate:hdd_usage_rate, remaining_battery_level:remaining_battery_level, 
          lldpdu_transmission_interval:lldpdu_transmission_interval, fdb: fdb};
        publishHtipInfor(node_to_send);
        node_list.add({
          ip: ip, mac: mac, maclist: maclist, type: htip_type, chassis_id: chassis_id, port_id: port_id,
          ttl: ttl, port_desc: port_desc, device_category: device_cat, manufacturer_code: manufacturer_code, 
          model_name: model_name, model_number: model_number, channel_usage_infor: channel_usage_infor,
          radio_signal_strength_infor: radio_signal_strength_infor, communication_error_rate_infor:communication_error_rate_infor,
          response_time: response_time, number_of_associated_devices: number_of_associated_devices, 
          number_of_active_nodes: number_of_active_nodes, link_quality:link_quality, number_of_retransmission:number_of_retransmission, 
          status_information:status_information, cpu_usage_rate:cpu_usage_rate, memory_usage_rate:memory_usage_rate,
          hdd_usage_rate:hdd_usage_rate, remaining_battery_level:remaining_battery_level, 
          lldpdu_transmission_interval:lldpdu_transmission_interval, fdb: fdb, expire: date
        });
        var nodes = node_list.get();
        console.log("  node_list len: " + nodes.length);
      });
    } catch (e) {
      console.log(e);
      console.log("Skip ifname: " + dev);
    }
  });
  upnp.startDiscovery();
};

HtipReceiver.prototype.getNodeList = function() {
  return node_list.get();
};

function arp_table_callback(ifname_i) {
  return function(err, table) {
    var date = new Date();
    date.setSeconds(date.getSeconds() + DEFAULT_TTL);
    var macs = table.map(function(v) {
      return v.mac;
    });
    for (var j = 0; j < macs.length; j++) {
      manager_fdb.push({port: ifname_i, mac: [macs[j]]});
    }
    for (var k = 0; k < table.length; k++) {
      if (table[k].mac !== null) {
        var node_to_send = {timeStamp: new Date(),ip: table[k].ip, mac: table[k].mac, maclist: [], type: "ARP", chassis_id: null, port_id: null,
        ttl: null, port_desc: null, device_category: null,
        manufacturer_code: null, model_name: null,
        model_number: null, channel_usage_infor: null,
        radio_signal_strength_infor: null, communication_error_rate_infor:null,
        response_time: null, number_of_associated_devices: null, 
        number_of_active_nodes: null, link_quality:null, number_of_retransmission:null, 
        status_information:null, cpu_usage_rate:null, memory_usage_rate:null,
        hdd_usage_rate:null, remaining_battery_level:null, 
        lldpdu_transmission_interval:null,fdb: []};
      publishHtipInfor(node_to_send);
        node_list.add({
          ip: table[k].ip, mac: table[k].mac, maclist: [], type: "ARP", chassis_id: null, port_id: null,
          ttl: null, port_desc: null, device_category: null,
          manufacturer_code: null, model_name: null,
          model_number: null, channel_usage_infor: null,
          radio_signal_strength_infor: null, communication_error_rate_infor:null,
          response_time: null, number_of_associated_devices: null, 
          number_of_active_nodes: null, link_quality:null, number_of_retransmission:null, 
          status_information:null, cpu_usage_rate:null, memory_usage_rate:null,
          hdd_usage_rate:null, remaining_battery_level:null, 
          lldpdu_transmission_interval:null,fdb: [], expire: date
        });
      }
    }
  };
}

HtipReceiver.prototype.updateArp = function() {
  manager_fdb = [];
  for (var i = 0; i < ifnames.length; i++) {
    arp.table(arp_table_callback, ifnames[i]);
  }
  var date = new Date();
  date.setSeconds(date.getSeconds() + 3600);
  if (manager_ip_mac.length > 0) {
    var macs = manager_ip_mac.map(function(v) {
      return v.mac_address;
    });
    var node_to_send = {timeStamp: new Date(),ip: manager_ip, mac: manager_mac, maclist: macs, type: "HTIP_Manager", chassis_id: null, port_id: null, 
    ttl: null, port_desc: null, device_category: null,
    manufacturer_code: null, model_name: null, model_number: null, channel_usage_infor: null,
    radio_signal_strength_infor: null, communication_error_rate_infor:null,
    response_time: null, number_of_associated_devices: null, 
    number_of_active_nodes: null, link_quality:null, number_of_retransmission:null, 
    status_information:null, cpu_usage_rate:null, memory_usage_rate:null,
    hdd_usage_rate:null, remaining_battery_level:null, 
    lldpdu_transmission_interval:null, 
    fdb: manager_fdb};
  publishHtipInfor(node_to_send);
    node_list.add({
      ip: manager_ip, mac: manager_mac, maclist: macs, type: "HTIP_Manager", chassis_id: null, port_id: null, 
      ttl: null, port_desc: null, device_category: null,
      manufacturer_code: null, model_name: null, model_number: null, channel_usage_infor: null,
      radio_signal_strength_infor: null, communication_error_rate_infor:null,
      response_time: null, number_of_associated_devices: null, 
      number_of_active_nodes: null, link_quality:null, number_of_retransmission:null, 
      status_information:null, cpu_usage_rate:null, memory_usage_rate:null,
      hdd_usage_rate:null, remaining_battery_level:null, 
      lldpdu_transmission_interval:null, 
      fdb: manager_fdb, expire: date
    });
  }
  // update L3 agent
  var upnp_devices = upnp.getActiveDeviceList();
  upnp_devices.forEach(function(device) {
    var ip = device.address;
    request({uri: device.headers.LOCATION, keepAlive: true, keepAliveMsecs: 10000 }, function(error, response, body) {
console.log(device.headers.LOCATION);
      if (error || response.statusCode !== 200) {
        return;
      }
      xml2js.parseString(body, function(err, result) {
        var fn = result.root.device[0].friendlyName;
        var manu = result.root.device[0].manufacturer;
        var manuurl = result.root.device[0]["manufacturerURL"];
        var modedes = result.root.device[0]["modelDescription"];
        var modenam = result.root.device[0]["modelName"];
        var modenum = result.root.device[0]["modelNumber"];
        var modelurl = result.root.device[0]["modelURL"];
        var serinum = result.root.device[0]["serialNumber"];
        var udn = result.root.device[0]["UDN"];
        var htipdc = result.root.device[0]["htip:X_DeviceCategory"];
        var htipmoui = result.root.device[0]["htip:X_ManufacturerOUI"];
        var htipcs = result.root.device[0]["htip:X_ChannelStatus"];
        var htiprssi = result.root.device[0]["htip:X_Rssi"];
        var htiper = result.root.device[0]["htip:X_ErrorRate"];
        var htipst = result.root.device[0]["htip:X_Status"];
        var htiprt = result.root.device[0]["htip:X_RT"];
        var htipnumass = result.root.device[0]["htip:X_NumAss"];
        var htipnumact = result.root.device[0]["htip:X_NumAct"];
        var htiplq = result.root.device[0]["htip:X_LQ"];
        var htipretc = result.root.device[0]["htip:X_RetC"];
        var htipcpu = result.root.device[0]["htip:X_CPU"];
        var htipmem = result.root.device[0]["htip:X_MEM"];
        var htiphdd = result.root.device[0]["htip:X_HDD"];
        var htippower = result.root.device[0]["htip:X_Power"];
        var htiplldpdu_transmission_interval = result.root.device[0]["htip:X_SysInterval"];

        var node_to_send = {timeStamp: new Date(),ip: ip, mac: null, maclist: [], type: "HTIP_L3_Agent", chassis_id: null, port_id: null, ttl: null, port_desc: null,
        device_category: htipdc, manufacturer_code: htipmoui, model_name: modenam, model_number: modenum,
        channel_usage_infor: htipcs, radio_signal_strength_infor: htiprssi, communication_error_rate_infor:htiper,
        response_time: htiprt, number_of_associated_devices: htipnumass,  number_of_active_nodes: htipnumact, 
        link_quality:htiplq, number_of_retransmission:htipretc, status_information:htipst, cpu_usage_rate:htipcpu, 
        emory_usage_rate:htipmem, hdd_usage_rate:htiphdd, remaining_battery_level:htippower, 
        lldpdu_transmission_interval:htiplldpdu_transmission_interval,  fdb: []};
      publishHtipInfor(node_to_send);
        node_list.add({
          ip: ip, mac: null, maclist: [], type: "HTIP_L3_Agent", chassis_id: null, port_id: null, ttl: null, port_desc: null,
          device_category: htipdc, manufacturer_code: htipmoui, model_name: modenam, model_number: modenum,
          channel_usage_infor: htipcs, radio_signal_strength_infor: htiprssi, communication_error_rate_infor:htiper,
          response_time: htiprt, number_of_associated_devices: htipnumass,  number_of_active_nodes: htipnumact, 
          link_quality:htiplq, number_of_retransmission:htipretc, status_information:htipst, cpu_usage_rate:htipcpu, 
          emory_usage_rate:htipmem, hdd_usage_rate:htiphdd, remaining_battery_level:htippower, 
          lldpdu_transmission_interval:htiplldpdu_transmission_interval,  fdb: [], expire: date
        });
      });
    });
  });
};

HtipReceiver.prototype.startArp = function() {
  get_manager_ip_mac();
  setInterval(this.updateArp, 5000);
};

module.exports = HtipReceiver;
