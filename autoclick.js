(function () {
	window.getPoint=function(v){
		return parseInt(Math.random()*30+v)
	}
	
	window.str2number = function(str){
		var result = 0, base=1;
		if(str.indexOf('K')>0){
			base = 1e3;
		} else if(str.indexOf('M')>0){
			base = 1e6;
		} else if(str.indexOf('B')>0){
			base = 1e10;
		}
		result= (str.replace(/[KMB,]/ig,'')-0) * base
		return result;
	}
	
	window.postReq = function (action, name=''){
		var authToken = localStorage.getItem("authToken");
		var xhr = new XMLHttpRequest();
		var host = 'https://api.hamsterkombat.io';
		var urls = {
			'Mine':'/clicker/buy-upgrade',
			'Upgrades':'/clicker/upgrades-for-buy',
			'Boost-query':'/clicker/boosts-for-buy',
			'Boost':'/clicker/buy-boost',
			'Check-task':'/clicker/check-task',
			'Daily-combo':'/clicker/claim-daily-combo',
			'Tap':'/clicker/tap'
		}
		xhr.open('POST', host + (urls[action]||action), true);
		xhr.setRequestHeader('Content-Type', 'application/json;charset=utf-8');
		xhr.setRequestHeader('Authorization', 'Bearer ' + authToken);
		xhr.onreadystatechange = function() {
			if (xhr.readyState === 4 && xhr.status === 200) {
				var response = JSON.parse(xhr.responseText)
				if(action=='Mine') {
					window.upgradesForBuy = response.upgradesForBuy;
				}else if(action=='Boost'){
					
				}else if(action=='Upgrades'){
					window.upgradesForBuy = response.upgradesForBuy;
				}else if(action=='Boost-query'){
					response.boostsForBuy.forEach(function(item){
						window.has_full_energy = false;
						if(item.id!='BoostFullAvailableTaps') return;
						if(item.level>item.maxLevel) return;
						window.has_full_energy = true;
					})
				}
			}
		};
		var data = {}
		if(action=='Mine') {
			data = {"upgradeId":name,"timestamp":(new Date()).getTime()}
		}else if(action=='Boost') {
			data = {"boostId":'BoostFullAvailableTaps',"timestamp":parseInt((new Date()).getTime()/1000)}
		}else if(action=='Check-task'){
			data = {taskId: "streak_days"}
		}else if(action=='Tap'){
			data = name
			data.timestamp = parseInt((new Date()).getTime()/1000);
		}
		
		xhr.send(JSON.stringify(data));
	}
	
	var start = document.querySelector('.button-primary');
	start && start.click();
	
	window.bestROI=parseInt(localStorage.getItem('bestROI') || 10);
	setInterval(function(){
		localStorage.setItem('bestROI', window.bestROI);
	}, 1000 * 10)
	setInterval(function(){
		window.bestROI +=2;
	}, 1000 * 3600 * 12)
	
	setInterval(function fn() {
		const energys=document.querySelector(".user-tap-energy");
		if(!energys) return;
		const energy = parseInt(energys.innerText.split(" / ")[0]);
		if (energy < 10) return;
		
		const evt1 = new PointerEvent('pointerdown', {clientX: getPoint(100), clientY: getPoint(300)});
		const evt2 = new PointerEvent('pointerup', {clientX: getPoint(270), clientY: getPoint(400)});
		const evt3 = new PointerEvent('pointerup', {clientX: getPoint(150), clientY: getPoint(350)});
		const evt4 = new PointerEvent('pointerup', {clientX: getPoint(200), clientY: getPoint(400)});
		var btn = document.querySelector('.user-tap-button');
		if(btn){
			btn.dispatchEvent(evt1);
			btn.dispatchEvent(evt2);
			btn.dispatchEvent(evt3);
			btn.dispatchEvent(evt4);
		}
	}, 50);
	
	window.boostInterval=1000 * 1800;
	setInterval((function fn(){
		console.log("full energy...")
		if(window.has_full_energy) return;
		
		const energys=document.querySelector(".user-tap-energy");
		if(!energys) return;
		const energy = parseInt(energys.innerText.split(" / ")[0]);
		window.postReq('Boost');
		return fn;
	})(), window.boostInterval);
	
	window.mineInterval = 1000 * 60;
	setInterval(function(){
		if(!window.upgradesForBuy) return;
		for(var i=0; i<window.upgradesForBuy.length; i++){
			var item = window.upgradesForBuy[i]
			if(!item.isAvailable || item.isExpired || item.price / item.currentProfitPerHour > window.bestROI) continue;
			if(item.cooldownSeconds && item.cooldownSeconds>0) continue;
			if(item.maxLevel && item.maxLevel<=item.level) continue;
			var balance = document.querySelector('.user-balance-large-inner').innerText.replaceAll(',','')-0;
			if(balance < item.price) continue;
			window.postReq('Mine', item.id);
			break;
		}
	}, window.mineInterval);
	
	setInterval((function fn(){
		window.postReq('Check-task');
		window.postReq('Upgrades');
		window.postReq('Boost-query');
		return fn
	})(), 1000 * 3600 *8)
})();
